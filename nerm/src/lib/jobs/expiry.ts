import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { dueStateForDates } from '@/lib/domain/lifecycle';
import { applyTransition } from '@/lib/domain/transition';
import { writeAudit, type AuditActor } from '@/lib/audit';

const SYSTEM: AuditActor = { kind: 'SYSTEM', label: 'Expiry sweep' };

/**
 * Move people whose engagement is ending toward EXPIRING and then INACTIVE.
 *
 * This is the control that makes an end date mean something. Without it, a
 * contractor whose engagement finished in March still has live access in
 * November, and the platform is a form rather than a safeguard.
 */
export async function runExpirySweep(now = new Date()): Promise<{
  flaggedExpiring: number;
  deactivated: number;
}> {
  const candidates = await prisma.person.findMany({
    where: {
      lifecycleState: { in: ['ACTIVE', 'EXPIRING'] },
      endDate: { not: null },
      archivedAt: null,
    },
    select: { id: true, lifecycleState: true, endDate: true, organizationId: true },
  });

  let flaggedExpiring = 0;
  let deactivated = 0;

  for (const person of candidates) {
    const due = dueStateForDates(
      person.lifecycleState,
      person.endDate,
      now,
      env.EXPIRY_WARNING_DAYS,
    );
    if (!due) continue;

    try {
      await applyTransition({
        personId: person.id,
        to: due,
        actor: SYSTEM,
        reason:
          due === 'EXPIRING'
            ? `End date is within ${env.EXPIRY_WARNING_DAYS} days`
            : 'End date has passed',
      });

      if (due === 'EXPIRING') flaggedExpiring += 1;
      else deactivated += 1;
    } catch (error) {
      // One bad record must not stop the sweep for everyone else.
      await writeAudit({
        organizationId: person.organizationId,
        action: 'job.expiry.failed',
        actor: SYSTEM,
        subjectType: 'Person',
        subjectId: person.id,
        metadata: { error: error instanceof Error ? error.message : 'unknown' },
      });
    }
  }

  return { flaggedExpiring, deactivated };
}
