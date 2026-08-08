import type { Prisma, TaskKind, TaskStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { writeAudit, type AuditActor } from '@/lib/audit';
import { applyTransition } from '@/lib/domain/transition';
import { canTransition } from '@/lib/domain/lifecycle';
import { evaluate } from './evaluator';
import { buildContext, type WorkflowContext } from './context';
import {
  durationToMs,
  workflowDefinitionSchema,
  type Assignee,
  type Stage,
  type WorkflowDefinition,
} from './schema';

const SYSTEM_ACTOR: AuditActor = { kind: 'SYSTEM', label: 'Workflow engine' };

/** Stages that create work and pause the instance until someone acts. */
type BlockingStage = Extract<Stage, { type: 'approval' | 'document' | 'task' }>;
type ImmediateStage = Extract<Stage, { type: 'transition' | 'notify' }>;

/**
 * A type guard rather than a `Set.has` check: `has` returns a plain boolean and
 * leaves the union unnarrowed, which is exactly the sort of thing that compiles
 * today and hands the wrong stage shape to a handler tomorrow.
 */
function isBlocking(stage: Stage): stage is BlockingStage {
  return stage.type === 'approval' || stage.type === 'document' || stage.type === 'task';
}

const TASK_KIND: Record<'approval' | 'document' | 'task', TaskKind> = {
  approval: 'APPROVAL',
  document: 'DOCUMENT',
  task: 'TASK',
};

// ---------------------------------------------------------------------------
// Simulation — the same stage-selection logic the engine uses, without writes.
// ---------------------------------------------------------------------------

export type SimulatedStage = {
  id: string;
  type: Stage['type'];
  name: string;
  /** Whether the stage's `when` condition selected it. */
  included: boolean;
  reason: string;
};

/**
 * Dry-run a definition against a context and report which stages would run.
 *
 * This is what makes the workflow configuration honest: an administrator can
 * see the path a definition produces before publishing it, rather than
 * discovering the answer through a real onboarding.
 */
export function simulate(
  definition: WorkflowDefinition,
  context: WorkflowContext,
): { triggered: boolean; triggerReason: string; stages: SimulatedStage[] } {
  let triggered = true;
  let triggerReason = 'Trigger condition is empty, so the workflow always starts';

  if (definition.trigger.when) {
    try {
      triggered = evaluate(definition.trigger.when, context);
      triggerReason = triggered
        ? `Trigger condition matched: ${definition.trigger.when}`
        : `Trigger condition did not match: ${definition.trigger.when}`;
    } catch (error) {
      triggered = false;
      triggerReason = `Trigger condition failed to evaluate: ${
        error instanceof Error ? error.message : 'unknown error'
      }`;
    }
  }

  const stages: SimulatedStage[] = definition.stages.map((stage) => {
    const name = stage.name ?? stage.id;
    if (!stage.when) {
      return { id: stage.id, type: stage.type, name, included: true, reason: 'No condition' };
    }
    try {
      const included = evaluate(stage.when, context);
      return {
        id: stage.id,
        type: stage.type,
        name,
        included,
        reason: `${included ? 'Matched' : 'Skipped'}: ${stage.when}`,
      };
    } catch (error) {
      return {
        id: stage.id,
        type: stage.type,
        name,
        included: false,
        reason: `Condition failed to evaluate: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      };
    }
  });

  return { triggered, triggerReason, stages };
}

// ---------------------------------------------------------------------------
// Assignee resolution
// ---------------------------------------------------------------------------

type PersonForAssignment = {
  id: string;
  organizationId: string;
  sponsorUserId: string | null;
  vendorCompanyId: string | null;
};

/**
 * Resolve an assignee to user ids. Returns an empty array when nobody matches,
 * which the caller turns into an escalation to administrators rather than a
 * silently unassigned task.
 */
async function resolveAssignee(
  assignee: Assignee,
  person: PersonForAssignment,
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  switch (assignee.kind) {
    case 'sponsor':
      return person.sponsorUserId ? [person.sponsorUserId] : [];

    case 'subject':
      // The non-employee has no login in v1, so their tasks fall to the sponsor.
      return person.sponsorUserId ? [person.sponsorUserId] : [];

    case 'vendorOwner': {
      if (!person.vendorCompanyId) return [];
      const vendor = await tx.vendorCompany.findUnique({
        where: { id: person.vendorCompanyId },
        select: { ownerUserId: true },
      });
      return vendor?.ownerUserId ? [vendor.ownerUserId] : [];
    }

    case 'role': {
      const assignments = await tx.roleAssignment.findMany({
        where: {
          role: assignee.role,
          user: { organizationId: person.organizationId, active: true },
        },
        select: { userId: true },
      });
      return assignments.map((a) => a.userId);
    }

    case 'user': {
      const user = await tx.user.findFirst({
        where: {
          organizationId: person.organizationId,
          email: assignee.email.toLowerCase(),
          active: true,
        },
        select: { id: true },
      });
      return user ? [user.id] : [];
    }
  }
}

/** Fallback when an assignee resolves to nobody: every IAM administrator. */
async function administrators(
  organizationId: string,
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const assignments = await tx.roleAssignment.findMany({
    where: { role: 'IAM_ADMIN', user: { organizationId, active: true } },
    select: { userId: true },
  });
  return assignments.map((a) => a.userId);
}

// ---------------------------------------------------------------------------
// Starting instances
// ---------------------------------------------------------------------------

export type TriggerEvent = WorkflowDefinition['trigger']['on'];

/**
 * Start the active workflow for a person, if one matches the event.
 * Returns the instance id, or null when no definition applies.
 */
export async function startWorkflow(params: {
  personId: string;
  event: TriggerEvent;
  /** Explicit definition key; otherwise taken from the person's profile type. */
  workflowKey?: string;
  actor?: AuditActor;
}): Promise<string | null> {
  const { personId, event } = params;
  const actor = params.actor ?? SYSTEM_ACTOR;

  const person = await prisma.person.findUniqueOrThrow({
    where: { id: personId },
    include: {
      profileType: { select: { workflowKey: true } },
      attributes: { include: { definition: { select: { key: true, kind: true } } } },
    },
  });

  const key = params.workflowKey ?? person.profileType.workflowKey;
  if (!key) return null;

  const record = await prisma.workflowDefinition.findFirst({
    where: { organizationId: person.organizationId, key, active: true },
  });
  if (!record) return null;

  const parsed = workflowDefinitionSchema.safeParse(record.definition);
  if (!parsed.success) {
    // A stored definition that no longer validates is a configuration fault,
    // not a user error. Record it and decline to start rather than half-running.
    await writeAudit({
      organizationId: person.organizationId,
      action: 'workflow.definition.invalid',
      actor: SYSTEM_ACTOR,
      subjectType: 'WorkflowDefinition',
      subjectId: record.id,
      metadata: { key, version: record.version },
    });
    return null;
  }

  const definition = parsed.data;
  if (definition.trigger.on !== event) return null;

  const attributes = Object.fromEntries(
    person.attributes.map((value) => [
      value.definition.key,
      value.stringValue ??
        value.numberValue ??
        value.boolValue ??
        value.dateValue?.toISOString() ??
        null,
    ]),
  );

  const context = buildContext(person, attributes);
  if (!evaluate(definition.trigger.when, context)) return null;

  const instance = await prisma.workflowInstance.create({
    data: {
      definitionId: record.id,
      personId,
      context: context as unknown as Prisma.InputJsonValue,
      status: 'RUNNING',
    },
  });

  await writeAudit({
    organizationId: person.organizationId,
    action: 'workflow.started',
    actor,
    subjectType: 'WorkflowInstance',
    subjectId: instance.id,
    metadata: { key: definition.key, version: record.version, personId },
  });

  await advance(instance.id);
  return instance.id;
}

// ---------------------------------------------------------------------------
// Advancing
// ---------------------------------------------------------------------------

/**
 * Walk the definition from the current position, executing non-blocking stages
 * and stopping at the first blocking stage (having created its task).
 */
export async function advance(instanceId: string): Promise<void> {
  const instance = await prisma.workflowInstance.findUniqueOrThrow({
    where: { id: instanceId },
    include: {
      definition: true,
      person: {
        select: {
          id: true,
          organizationId: true,
          sponsorUserId: true,
          vendorCompanyId: true,
        },
      },
    },
  });

  if (instance.status !== 'RUNNING') return;

  const parsed = workflowDefinitionSchema.safeParse(instance.definition.definition);
  if (!parsed.success) {
    await failInstance(instanceId, 'Definition no longer valid');
    return;
  }

  const definition = parsed.data;
  const context = instance.context as unknown as WorkflowContext;

  // Resume after the stage we last stopped on.
  const startIndex = instance.currentStage
    ? definition.stages.findIndex((s) => s.id === instance.currentStage) + 1
    : 0;

  for (let i = startIndex; i < definition.stages.length; i += 1) {
    const stage = definition.stages[i];
    if (!stage) break;

    let included: boolean;
    try {
      included = evaluate(stage.when, context);
    } catch {
      await failInstance(instanceId, `Stage "${stage.id}" condition failed to evaluate`);
      return;
    }

    if (!included) continue;

    if (isBlocking(stage)) {
      await createTasksForStage(instance.id, stage, instance.person);
      await prisma.workflowInstance.update({
        where: { id: instance.id },
        data: { currentStage: stage.id },
      });
      return; // Wait for a human.
    }

    await executeImmediateStage(instance.id, stage, instance.person);
    await prisma.workflowInstance.update({
      where: { id: instance.id },
      data: { currentStage: stage.id },
    });
  }

  await completeInstance(instanceId);
}

async function createTasksForStage(
  instanceId: string,
  stage: BlockingStage,
  person: PersonForAssignment,
): Promise<void> {
  // Raising an approval task *is* the person entering approval. Without this,
  // a workflow triggered on person.created leaves the record in DRAFT while an
  // approver decides it, and the later `transition -> APPROVED` stage then has
  // no legal edge to take — the instance dies halfway through. Moving the state
  // here keeps the lifecycle honest about what is actually happening.
  if (stage.type === 'approval') {
    const current = await prisma.person.findUniqueOrThrow({
      where: { id: person.id },
      select: { lifecycleState: true },
    });

    if (canTransition(current.lifecycleState, 'PENDING_APPROVAL')) {
      await applyTransition({
        personId: person.id,
        to: 'PENDING_APPROVAL',
        actor: SYSTEM_ACTOR,
        reason: `Awaiting "${stage.name ?? stage.id}"`,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    let assignees = await resolveAssignee(stage.assignee, person, tx);
    let escalated = false;

    if (assignees.length === 0) {
      assignees = await administrators(person.organizationId, tx);
      escalated = true;
    }

    const dueAt =
      'sla' in stage && stage.sla ? new Date(Date.now() + durationToMs(stage.sla)) : null;

    const title =
      stage.type === 'task' && stage.title
        ? stage.title
        : (stage.name ??
          (stage.type === 'approval'
            ? 'Approval required'
            : stage.type === 'document'
              ? `Upload ${stage.requires.join(', ')}`
              : stage.id));

    // A stage with no resolvable assignee still produces work — it lands with
    // administrators rather than vanishing.
    for (const assigneeId of assignees.length ? assignees : [null]) {
      await tx.workflowTask.create({
        data: {
          instanceId,
          stageId: stage.id,
          kind: TASK_KIND[stage.type],
          title,
          assigneeId,
          dueAt,
          payload:
            stage.type === 'document'
              ? ({ requires: stage.requires } as Prisma.InputJsonValue)
              : undefined,
        },
      });
    }

    await writeAudit(
      {
        organizationId: person.organizationId,
        action: 'workflow.task.created',
        actor: SYSTEM_ACTOR,
        subjectType: 'WorkflowInstance',
        subjectId: instanceId,
        metadata: {
          stageId: stage.id,
          assigneeCount: assignees.length,
          escalatedToAdmins: escalated,
        },
      },
      tx,
    );
  });
}

async function executeImmediateStage(
  instanceId: string,
  stage: ImmediateStage,
  person: PersonForAssignment,
): Promise<void> {
  if (stage.type === 'transition') {
    await applyTransition({
      personId: person.id,
      to: stage.to,
      actor: SYSTEM_ACTOR,
      reason: `Workflow stage "${stage.id}"`,
    });
    return;
  }

  // Notification delivery is a later phase; the audit record is the contract
  // that the stage ran, so nothing is silently skipped.
  await writeAudit({
    organizationId: person.organizationId,
    action: 'workflow.notification.queued',
    actor: SYSTEM_ACTOR,
    subjectType: 'WorkflowInstance',
    subjectId: instanceId,
    metadata: { stageId: stage.id, template: stage.template, to: stage.to },
  });
}

// ---------------------------------------------------------------------------
// Task decisions
// ---------------------------------------------------------------------------

export type TaskDecision = 'APPROVED' | 'REJECTED' | 'COMPLETED';

/**
 * Record a decision on a task and move the instance on.
 *
 * Authorization is the caller's responsibility — the API layer checks that the
 * actor owns the task before calling this.
 */
export async function decideTask(params: {
  taskId: string;
  decision: TaskDecision;
  actor: AuditActor;
  comment?: string;
}): Promise<void> {
  const { taskId, decision, actor, comment } = params;

  const task = await prisma.workflowTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      instance: {
        include: {
          definition: true,
          person: { select: { id: true, organizationId: true } },
        },
      },
    },
  });

  if (task.status !== 'PENDING') {
    throw new Error(`Task ${taskId} has already been decided (${task.status})`);
  }

  const organizationId = task.instance.person.organizationId;

  await prisma.$transaction(async (tx) => {
    await tx.workflowTask.update({
      where: { id: taskId },
      data: {
        status: decision as TaskStatus,
        decidedAt: new Date(),
        decidedBy: actor.id ?? null,
        comment: comment ?? null,
      },
    });

    // Sibling tasks for the same stage are satisfied by the first decision —
    // a role-assigned approval needs one approver, not all of them.
    await tx.workflowTask.updateMany({
      where: {
        instanceId: task.instanceId,
        stageId: task.stageId,
        status: 'PENDING',
        id: { not: taskId },
      },
      data: { status: 'SKIPPED', decidedAt: new Date() },
    });

    await writeAudit(
      {
        organizationId,
        action: `workflow.task.${decision.toLowerCase()}`,
        actor,
        subjectType: 'WorkflowTask',
        subjectId: taskId,
        metadata: { stageId: task.stageId, instanceId: task.instanceId },
        changes: comment ? [{ field: 'comment', from: null, to: comment }] : undefined,
      },
      tx,
    );
  });

  if (decision === 'REJECTED') {
    const parsed = workflowDefinitionSchema.safeParse(task.instance.definition.definition);
    const stage = parsed.success
      ? parsed.data.stages.find((s) => s.id === task.stageId)
      : undefined;
    const target = stage && stage.type === 'approval' ? stage.onReject : 'REJECTED';

    await applyTransition({
      personId: task.instance.person.id,
      to: target,
      actor,
      reason: comment ?? 'Rejected during approval',
    });

    await cancelInstance(task.instanceId, 'Rejected at approval stage');
    return;
  }

  await advance(task.instanceId);
}

// ---------------------------------------------------------------------------
// Instance terminal states
// ---------------------------------------------------------------------------

async function completeInstance(instanceId: string): Promise<void> {
  const instance = await prisma.workflowInstance.update({
    where: { id: instanceId },
    data: { status: 'COMPLETED', completedAt: new Date() },
    include: { person: { select: { organizationId: true } } },
  });

  await writeAudit({
    organizationId: instance.person.organizationId,
    action: 'workflow.completed',
    actor: SYSTEM_ACTOR,
    subjectType: 'WorkflowInstance',
    subjectId: instanceId,
  });
}

async function cancelInstance(instanceId: string, reason: string): Promise<void> {
  const instance = await prisma.workflowInstance.update({
    where: { id: instanceId },
    data: { status: 'CANCELLED', completedAt: new Date() },
    include: { person: { select: { organizationId: true } } },
  });

  await prisma.workflowTask.updateMany({
    where: { instanceId, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });

  await writeAudit({
    organizationId: instance.person.organizationId,
    action: 'workflow.cancelled',
    actor: SYSTEM_ACTOR,
    subjectType: 'WorkflowInstance',
    subjectId: instanceId,
    metadata: { reason },
  });
}

async function failInstance(instanceId: string, reason: string): Promise<void> {
  const instance = await prisma.workflowInstance.update({
    where: { id: instanceId },
    data: { status: 'FAILED', completedAt: new Date() },
    include: { person: { select: { organizationId: true } } },
  });

  await writeAudit({
    organizationId: instance.person.organizationId,
    action: 'workflow.failed',
    actor: SYSTEM_ACTOR,
    subjectType: 'WorkflowInstance',
    subjectId: instanceId,
    metadata: { reason },
  });
}

// ---------------------------------------------------------------------------
// SLA sweep
// ---------------------------------------------------------------------------

/**
 * Escalate or auto-approve overdue tasks. Invoked by the scheduled job at
 * /api/v1/jobs/sla.
 */
export async function sweepOverdueTasks(now = new Date()): Promise<{
  escalated: number;
  autoApproved: number;
}> {
  const overdue = await prisma.workflowTask.findMany({
    where: { status: 'PENDING', dueAt: { lte: now } },
    include: {
      instance: {
        include: {
          definition: true,
          person: {
            select: {
              id: true,
              organizationId: true,
              sponsorUserId: true,
              vendorCompanyId: true,
            },
          },
        },
      },
    },
  });

  let escalated = 0;
  let autoApproved = 0;

  for (const task of overdue) {
    const parsed = workflowDefinitionSchema.safeParse(task.instance.definition.definition);
    if (!parsed.success) continue;

    const stage = parsed.data.stages.find((s) => s.id === task.stageId);
    if (!stage || !('onTimeout' in stage)) continue;

    if (stage.onTimeout === 'autoApprove') {
      await decideTask({
        taskId: task.id,
        decision: task.kind === 'APPROVAL' ? 'APPROVED' : 'COMPLETED',
        actor: SYSTEM_ACTOR,
        comment: 'Auto-approved after SLA expiry',
      });
      autoApproved += 1;
      continue;
    }

    if (stage.onTimeout === 'escalate' && stage.escalateTo) {
      await prisma.$transaction(async (tx) => {
        const targets = await resolveAssignee(
          stage.escalateTo as Assignee,
          task.instance.person,
          tx,
        );
        const fallback = targets.length
          ? targets
          : await administrators(task.instance.person.organizationId, tx);

        await tx.workflowTask.update({
          where: { id: task.id },
          data: { status: 'ESCALATED', decidedAt: new Date() },
        });

        for (const assigneeId of fallback) {
          await tx.workflowTask.create({
            data: {
              instanceId: task.instanceId,
              stageId: task.stageId,
              kind: task.kind,
              title: `[Escalated] ${task.title}`,
              assigneeId,
              payload: task.payload ?? undefined,
            },
          });
        }

        await writeAudit(
          {
            organizationId: task.instance.person.organizationId,
            action: 'workflow.task.escalated',
            actor: SYSTEM_ACTOR,
            subjectType: 'WorkflowTask',
            subjectId: task.id,
            metadata: { stageId: task.stageId, reassignedTo: fallback.length },
          },
          tx,
        );
      });
      escalated += 1;
    }
  }

  return { escalated, autoApproved };
}
