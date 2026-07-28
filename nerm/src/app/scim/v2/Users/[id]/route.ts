import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { updatePerson, ValidationError } from '@/lib/domain/person';
import { applyTransition } from '@/lib/domain/transition';
import { canTransition, isActiveState } from '@/lib/domain/lifecycle';
import {
  applyPatch,
  fromScimUser,
  personEtag,
  toScimUser,
  type PatchOperation,
} from '@/lib/scim/mapper';
import {
  authorizeScim,
  baseUrlFrom,
  scimErrorResponse,
  scimJson,
  toScimErrorResponse,
} from '@/lib/scim/handler';
import type { AuditActor } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const INCLUDE = {
  vendorCompany: { select: { id: true, name: true } },
  sponsor: { select: { id: true, name: true, email: true } },
} satisfies Prisma.PersonInclude;

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const authorized = await authorizeScim(request, 'scim:read');
  if ('response' in authorized) return authorized.response;

  const { id } = await params;
  const person = await prisma.person.findFirst({
    where: { id, organizationId: authorized.actor.organizationId, archivedAt: null },
    include: INCLUDE,
  });

  if (!person) return scimErrorResponse(404, `User ${id} not found`);

  const etag = personEtag(person);
  // Conditional GET: let a client skip a body it already has.
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return scimJson(toScimUser(person, baseUrlFrom(request)), { headers: { ETag: etag } });
}

/**
 * PUT replaces the resource. PATCH applies operations. Both funnel into the
 * same write path so that `active` is always translated into a real lifecycle
 * transition rather than a flag that could contradict the state machine.
 */
export async function PUT(request: Request, { params }: Params) {
  return write(request, params, 'PUT');
}

export async function PATCH(request: Request, { params }: Params) {
  return write(request, params, 'PATCH');
}

async function write(
  request: Request,
  params: Promise<{ id: string }>,
  method: 'PUT' | 'PATCH',
) {
  const authorized = await authorizeScim(request, 'scim:write');
  if ('response' in authorized) return authorized.response;

  try {
    const { id } = await params;
    const baseUrl = baseUrlFrom(request);

    const existing = await prisma.person.findFirst({
      where: { id, organizationId: authorized.actor.organizationId, archivedAt: null },
      include: INCLUDE,
    });
    if (!existing) return scimErrorResponse(404, `User ${id} not found`);

    // Optimistic concurrency: honour If-Match when the client sends it.
    const ifMatch = request.headers.get('if-match');
    if (ifMatch && ifMatch !== personEtag(existing)) {
      return scimErrorResponse(
        412,
        'The resource has changed since it was read',
        'preconditionFailed',
      );
    }

    const body = (await request.json()) as Record<string, unknown>;

    let representation: Record<string, unknown>;
    if (method === 'PUT') {
      representation = body;
    } else {
      const operations = body.Operations;
      if (!Array.isArray(operations)) {
        return scimErrorResponse(400, 'PATCH requires an "Operations" array', 'invalidValue');
      }
      representation = applyPatch(
        toScimUser(existing, baseUrl) as Record<string, unknown>,
        operations as PatchOperation[],
      );
    }

    const input = fromScimUser(representation);
    const actor: AuditActor = {
      kind: 'API_CLIENT',
      id: authorized.actor.client.id,
      label: authorized.actor.client.name,
    };

    await updatePerson(
      id,
      {
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        jobTitle: input.jobTitle ?? null,
        department: input.department ?? null,
        location: input.location ?? null,
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
        ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
      },
      actor,
    );

    // `active` is not a column — translate it into a lifecycle transition, and
    // decline politely if the state machine has no such edge.
    if (input.active !== undefined && input.active !== isActiveState(existing.lifecycleState)) {
      const target = input.active ? 'ACTIVE' : 'INACTIVE';
      if (canTransition(existing.lifecycleState, target)) {
        await applyTransition({
          personId: id,
          to: target,
          actor,
          reason: `SCIM ${method} set active=${input.active}`,
        });
      } else {
        return scimErrorResponse(
          400,
          `Cannot set active=${input.active}: no transition from ${existing.lifecycleState} to ${target}`,
          'mutability',
        );
      }
    }

    const updated = await prisma.person.findUniqueOrThrow({
      where: { id },
      include: INCLUDE,
    });

    return scimJson(toScimUser(updated, baseUrl), {
      headers: { ETag: personEtag(updated) },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      const detail = error.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
      return scimErrorResponse(400, detail || error.message, 'invalidValue');
    }
    return toScimErrorResponse(error);
  }
}

/**
 * DELETE deactivates rather than destroying. A non-employee record is evidence
 * of who had access and when; hard-deleting it would break the audit trail the
 * platform exists to provide.
 */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeScim(request, 'scim:write');
  if ('response' in authorized) return authorized.response;

  try {
    const { id } = await params;
    const person = await prisma.person.findFirst({
      where: { id, organizationId: authorized.actor.organizationId, archivedAt: null },
    });
    if (!person) return scimErrorResponse(404, `User ${id} not found`);

    // Deactivate where that is meaningful; a record that never went live is
    // archived instead. If neither edge exists, say so rather than returning
    // 204 for a request that changed nothing — a silent no-op behind a success
    // status is how a client comes to believe access was revoked when it was not.
    const target = canTransition(person.lifecycleState, 'INACTIVE')
      ? 'INACTIVE'
      : canTransition(person.lifecycleState, 'ARCHIVED')
        ? 'ARCHIVED'
        : null;

    if (!target) {
      return scimErrorResponse(
        409,
        `Cannot deactivate a user in state ${person.lifecycleState}`,
        'mutability',
      );
    }

    await applyTransition({
      personId: id,
      to: target,
      actor: {
        kind: 'API_CLIENT',
        id: authorized.actor.client.id,
        label: authorized.actor.client.name,
      },
      reason: 'SCIM DELETE',
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    return toScimErrorResponse(error);
  }
}
