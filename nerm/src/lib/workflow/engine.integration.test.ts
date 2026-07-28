import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPerson } from '@/lib/domain/person';
import { decideTask, startWorkflow, sweepOverdueTasks } from './engine';
import { runExpirySweep } from '@/lib/jobs/expiry';
import {
  canWritePerson,
  personScope,
  taskScope,
  type Actor,
} from '@/lib/authz/scope';

/**
 * Integration tests against a real database.
 *
 * The workflow engine and the authorization layer are the two places where a
 * unit test with a mocked client would prove nothing: the first is defined by
 * what it writes across several tables in a transaction, and the second is
 * defined by what SQL it actually produces. Both are exercised against Postgres.
 *
 * Requires DATABASE_URL and a migrated schema (see the README).
 */

const prisma = new PrismaClient();

let organizationId: string;
let profileTypeId: string;
let sponsorId: string;
let adminId: string;
let acmeId: string;
let northwindId: string;

const SUFFIX = Date.now().toString(36);
const created: string[] = [];

const systemActor = { kind: 'SYSTEM' as const, label: 'test' };

beforeAll(async () => {
  const organization = await prisma.organization.findFirstOrThrow({
    where: { domain: 'example.com' },
  });
  organizationId = organization.id;

  profileTypeId = (
    await prisma.profileType.findFirstOrThrow({
      where: { organizationId, key: 'contractor' },
    })
  ).id;

  sponsorId = (
    await prisma.user.findFirstOrThrow({
      where: { organizationId, email: 'sam.sponsor@example.com' },
    })
  ).id;

  adminId = (
    await prisma.user.findFirstOrThrow({
      where: { organizationId, email: 'admin.iam@example.com' },
    })
  ).id;

  acmeId = (
    await prisma.vendorCompany.findFirstOrThrow({
      where: { organizationId, name: 'Acme Consulting' },
    })
  ).id;

  northwindId = (
    await prisma.vendorCompany.findFirstOrThrow({
      where: { organizationId, name: 'Northwind Services' },
    })
  ).id;
});

afterAll(async () => {
  if (created.length) {
    await prisma.person.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.$disconnect();
});

async function makePerson(overrides: Partial<Parameters<typeof createPerson>[0]> = {}) {
  const person = await createPerson(
    {
      organizationId,
      profileTypeId,
      type: 'CONTRACTOR',
      firstName: 'Test',
      lastName: 'Person',
      email: `test-${SUFFIX}-${created.length}@example.test`,
      riskTier: 'LOW',
      sponsorUserId: sponsorId,
      vendorCompanyId: acmeId,
      startDate: new Date(),
      endDate: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
      attributes: { costCenter: 'CC-TEST', workLocation: 'remote' },
      ...overrides,
    },
    systemActor,
    { startWorkflows: false },
  );
  created.push(person.id);
  return person;
}

describe('workflow engine', () => {
  it('starts the profile type workflow and creates the first approval task', async () => {
    const person = await makePerson();

    const instanceId = await startWorkflow({
      personId: person.id,
      event: 'person.created',
      actor: systemActor,
    });

    expect(instanceId).not.toBeNull();

    const tasks = await prisma.workflowTask.findMany({
      where: { instanceId: instanceId! },
    });

    // It stops at the first blocking stage rather than running to completion.
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.stageId).toBe('sponsor-approval');
    expect(tasks[0]!.assigneeId).toBe(sponsorId);
    expect(tasks[0]!.dueAt).not.toBeNull();
  });

  it('drives a person all the way to ACTIVE through successive approvals', async () => {
    const person = await makePerson();
    const instanceId = await startWorkflow({
      personId: person.id,
      event: 'person.created',
      actor: systemActor,
    });

    // Work the queue until the instance finishes.
    for (let guard = 0; guard < 10; guard += 1) {
      const task = await prisma.workflowTask.findFirst({
        where: { instanceId: instanceId!, status: 'PENDING' },
      });
      if (!task) break;

      await decideTask({
        taskId: task.id,
        decision: task.kind === 'APPROVAL' ? 'APPROVED' : 'COMPLETED',
        actor: { kind: 'USER', id: sponsorId, label: 'sam.sponsor@example.com' },
      });
    }

    const finished = await prisma.person.findUniqueOrThrow({ where: { id: person.id } });
    const instance = await prisma.workflowInstance.findUniqueOrThrow({
      where: { id: instanceId! },
    });

    expect(instance.status).toBe('COMPLETED');
    expect(finished.lifecycleState).toBe('ACTIVE');

    // The full lifecycle path was recorded, not just the final state. Raising
    // the first approval task moves the person into PENDING_APPROVAL, so the
    // record is never sitting in DRAFT while somebody is approving it.
    const transitions = await prisma.lifecycleTransition.findMany({
      where: { personId: person.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(transitions.map((t) => t.to)).toEqual([
      'PENDING_APPROVAL',
      'APPROVED',
      'ACTIVE',
    ]);
  });

  it('includes conditional stages only when the condition matches', async () => {
    const lowRisk = await makePerson({ riskTier: 'LOW' });
    const highRisk = await makePerson({ riskTier: 'HIGH' });

    const lowInstance = await startWorkflow({
      personId: lowRisk.id,
      event: 'person.created',
      actor: systemActor,
    });
    const highInstance = await startWorkflow({
      personId: highRisk.id,
      event: 'person.created',
      actor: systemActor,
    });

    // Approve through to where the screening stage would appear.
    async function stagesReached(instanceId: string) {
      const seen: string[] = [];
      for (let guard = 0; guard < 10; guard += 1) {
        const task = await prisma.workflowTask.findFirst({
          where: { instanceId, status: 'PENDING' },
        });
        if (!task) break;
        seen.push(task.stageId);
        await decideTask({
          taskId: task.id,
          decision: task.kind === 'APPROVAL' ? 'APPROVED' : 'COMPLETED',
          actor: { kind: 'USER', id: adminId, label: 'admin' },
        });
      }
      return seen;
    }

    expect(await stagesReached(lowInstance!)).not.toContain('screening');
    expect(await stagesReached(highInstance!)).toContain('screening');
  });

  it('rejects the person and cancels the instance when an approval is rejected', async () => {
    const person = await makePerson();
    const instanceId = await startWorkflow({
      personId: person.id,
      event: 'person.created',
      actor: systemActor,
    });

    const task = await prisma.workflowTask.findFirstOrThrow({
      where: { instanceId: instanceId!, status: 'PENDING' },
    });

    await decideTask({
      taskId: task.id,
      decision: 'REJECTED',
      actor: { kind: 'USER', id: sponsorId, label: 'sam' },
      comment: 'Not budgeted',
    });

    const after = await prisma.person.findUniqueOrThrow({ where: { id: person.id } });
    const instance = await prisma.workflowInstance.findUniqueOrThrow({
      where: { id: instanceId! },
    });

    expect(after.lifecycleState).toBe('REJECTED');
    expect(instance.status).toBe('CANCELLED');
  });

  it('refuses to decide a task twice', async () => {
    const person = await makePerson();
    const instanceId = await startWorkflow({
      personId: person.id,
      event: 'person.created',
      actor: systemActor,
    });
    const task = await prisma.workflowTask.findFirstOrThrow({
      where: { instanceId: instanceId!, status: 'PENDING' },
    });

    await decideTask({ taskId: task.id, decision: 'APPROVED', actor: systemActor });

    await expect(
      decideTask({ taskId: task.id, decision: 'REJECTED', actor: systemActor }),
    ).rejects.toThrow(/already been decided/);
  });

  it('escalates a task once its SLA has passed', async () => {
    const person = await makePerson();
    const instanceId = await startWorkflow({
      personId: person.id,
      event: 'person.created',
      actor: systemActor,
    });

    const task = await prisma.workflowTask.findFirstOrThrow({
      where: { instanceId: instanceId!, status: 'PENDING' },
    });

    // Backdate the due date rather than waiting three days.
    await prisma.workflowTask.update({
      where: { id: task.id },
      data: { dueAt: new Date(Date.now() - 1000) },
    });

    const result = await sweepOverdueTasks();
    expect(result.escalated).toBeGreaterThan(0);

    const escalated = await prisma.workflowTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(escalated.status).toBe('ESCALATED');

    // The work did not vanish — a replacement task exists for the same stage.
    const replacement = await prisma.workflowTask.findFirst({
      where: { instanceId: instanceId!, stageId: task.stageId, status: 'PENDING' },
    });
    expect(replacement).not.toBeNull();
    expect(replacement!.title).toContain('[Escalated]');
  });

  it('writes an audit event for every state change', async () => {
    const person = await makePerson();
    await startWorkflow({ personId: person.id, event: 'person.created', actor: systemActor });

    const events = await prisma.auditEvent.findMany({
      where: { subjectId: person.id, subjectType: 'Person' },
    });

    expect(events.map((e) => e.action)).toContain('person.created');
  });
});

describe('expiry sweep', () => {
  it('flags a person as EXPIRING when their end date is near, then INACTIVE when it passes', async () => {
    const person = await makePerson({
      endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });
    await prisma.person.update({
      where: { id: person.id },
      data: { lifecycleState: 'ACTIVE' },
    });

    await runExpirySweep();
    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: person.id } })).lifecycleState,
    ).toBe('EXPIRING');

    // Move the whole engagement into the past and sweep again. Both dates have
    // to move: the database rejects an end date before the start date.
    await prisma.person.update({
      where: { id: person.id },
      data: {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    await runExpirySweep();
    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: person.id } })).lifecycleState,
    ).toBe('INACTIVE');
  });

  it('leaves people without an end date alone', async () => {
    const person = await makePerson({ endDate: null });
    await prisma.person.update({
      where: { id: person.id },
      data: { lifecycleState: 'ACTIVE' },
    });

    await runExpirySweep();
    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: person.id } })).lifecycleState,
    ).toBe('ACTIVE');
  });
});

// ---------------------------------------------------------------------------
// The isolation tests. These are the ones that matter.
// ---------------------------------------------------------------------------

describe('authorization scoping', () => {
  function vendorAdmin(vendorCompanyId: string): Actor {
    return {
      userId: 'vendor-admin-test',
      organizationId,
      email: 'vendor@test',
      name: 'Vendor Admin',
      roles: [{ role: 'VENDOR_ADMIN', vendorCompanyId }],
    };
  }

  const admin: Actor = {
    userId: 'admin-test',
    organizationId: '',
    email: 'admin@test',
    name: 'Admin',
    roles: [{ role: 'IAM_ADMIN', vendorCompanyId: null }],
  };

  it('never returns another vendor\'s people to a vendor administrator', async () => {
    const acmePerson = await makePerson({ vendorCompanyId: acmeId });
    const northwindPerson = await makePerson({ vendorCompanyId: northwindId });

    const visible = await prisma.person.findMany({
      where: personScope(vendorAdmin(acmeId)),
      select: { id: true, vendorCompanyId: true },
    });

    const ids = visible.map((p) => p.id);
    expect(ids).toContain(acmePerson.id);
    expect(ids).not.toContain(northwindPerson.id);

    // Stronger: no row from any other vendor appears at all.
    expect(visible.every((p) => p.vendorCompanyId === acmeId)).toBe(true);
  });

  it('cannot be widened by combining the scope with an attacker-supplied filter', async () => {
    const northwindPerson = await makePerson({ vendorCompanyId: northwindId });

    // Simulate a route that naively ANDs a user-supplied filter onto the scope.
    const hostile = await prisma.person.findMany({
      where: {
        AND: [personScope(vendorAdmin(acmeId)), { id: northwindPerson.id }],
      },
    });

    // The scope wins: an explicit id for another vendor's person yields nothing.
    expect(hostile).toHaveLength(0);
  });

  it('denies a vendor administrator with no vendor assignment everything', async () => {
    const malformed: Actor = {
      userId: 'x',
      organizationId,
      email: 'x@test',
      name: 'X',
      roles: [{ role: 'VENDOR_ADMIN', vendorCompanyId: null }],
    };

    const visible = await prisma.person.findMany({ where: personScope(malformed) });
    expect(visible).toHaveLength(0);
  });

  it('scopes tasks to the vendor as well', async () => {
    const northwindPerson = await makePerson({ vendorCompanyId: northwindId });
    const instanceId = await startWorkflow({
      personId: northwindPerson.id,
      event: 'person.created',
      actor: systemActor,
    });

    const visible = await prisma.workflowTask.findMany({
      where: { AND: [taskScope(vendorAdmin(acmeId)), { instanceId: instanceId! }] },
    });

    expect(visible).toHaveLength(0);
  });

  it('never crosses an organization boundary, even for an administrator', async () => {
    const person = await makePerson();

    const otherOrgAdmin: Actor = { ...admin, organizationId: 'some-other-org' };
    const visible = await prisma.person.findMany({
      where: { AND: [personScope(otherOrgAdmin), { id: person.id }] },
    });

    expect(visible).toHaveLength(0);
  });

  it('lets a sponsor write only their own people', async () => {
    const sponsor: Actor = {
      userId: sponsorId,
      organizationId,
      email: 'sam.sponsor@example.com',
      name: 'Sam',
      roles: [{ role: 'SPONSOR', vendorCompanyId: null }],
    };

    expect(
      canWritePerson(sponsor, {
        organizationId,
        sponsorUserId: sponsorId,
        vendorCompanyId: null,
      }),
    ).toBe(true);

    expect(
      canWritePerson(sponsor, {
        organizationId,
        sponsorUserId: 'someone-else',
        vendorCompanyId: null,
      }),
    ).toBe(false);
  });

  it('stops a vendor administrator writing to a person outside their vendor', async () => {
    const actor = vendorAdmin(acmeId);

    expect(
      canWritePerson(actor, {
        organizationId,
        sponsorUserId: null,
        vendorCompanyId: acmeId,
      }),
    ).toBe(true);

    expect(
      canWritePerson(actor, {
        organizationId,
        sponsorUserId: null,
        vendorCompanyId: northwindId,
      }),
    ).toBe(false);

    // A person with no vendor at all is not theirs either.
    expect(
      canWritePerson(actor, {
        organizationId,
        sponsorUserId: null,
        vendorCompanyId: null,
      }),
    ).toBe(false);
  });
});

describe('audit log immutability', () => {
  it('rejects an update at the database level', async () => {
    const event = await prisma.auditEvent.findFirstOrThrow();

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "AuditEvent" SET action = 'tampered' WHERE id = '${event.id}'`,
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects a delete at the database level', async () => {
    const event = await prisma.auditEvent.findFirstOrThrow();

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id = '${event.id}'`),
    ).rejects.toThrow(/append-only/);
  });
});
