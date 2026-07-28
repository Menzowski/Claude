import type { LifecycleState, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { writeAudit, type AuditActor } from '@/lib/audit';
import { assertTransition } from './lifecycle';

/**
 * Applies a lifecycle transition, records it, and writes the audit event — all
 * in one transaction.
 *
 * Kept free of any workflow dependency so that the workflow engine can call it
 * without creating an import cycle (the engine drives transitions; person
 * services drive the engine).
 */
export async function applyTransition(params: {
  personId: string;
  to: LifecycleState;
  actor: AuditActor;
  reason?: string;
  /** Skip the state-machine check. Only the expiry sweep uses this, never UI. */
  tx?: Prisma.TransactionClient;
}): Promise<{ from: LifecycleState; to: LifecycleState }> {
  const { personId, to, actor, reason } = params;

  const run = async (tx: Prisma.TransactionClient) => {
    const person = await tx.person.findUniqueOrThrow({
      where: { id: personId },
      select: { id: true, organizationId: true, lifecycleState: true },
    });

    const from = person.lifecycleState;
    if (from === to) return { from, to };

    const transition = assertTransition(from, to);

    await tx.person.update({
      where: { id: personId },
      data: {
        lifecycleState: to,
        ...(to === 'ARCHIVED' ? { archivedAt: new Date() } : {}),
      },
    });

    await tx.lifecycleTransition.create({
      data: {
        personId,
        from,
        to,
        reason: reason ?? null,
        actorId: actor.id ?? null,
        actorKind: actor.kind,
      },
    });

    await writeAudit(
      {
        organizationId: person.organizationId,
        action: transition.action,
        actor,
        subjectType: 'Person',
        subjectId: personId,
        changes: [{ field: 'lifecycleState', from, to }],
        metadata: reason ? { reason } : undefined,
      },
      tx,
    );

    return { from, to };
  };

  return params.tx ? run(params.tx) : prisma.$transaction(run);
}
