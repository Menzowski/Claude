import { prisma } from '@/lib/db';
import { isAdmin, taskScope, type Actor } from '@/lib/authz/scope';

/** Scoped task reads. Every query composes `taskScope`. */

export async function listPendingTasks(actor: Actor) {
  return prisma.workflowTask.findMany({
    where: { AND: [taskScope(actor), { status: 'PENDING' }] },
    include: {
      instance: {
        include: {
          definition: { select: { name: true } },
          person: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              riskTier: true,
              endDate: true,
            },
          },
        },
      },
    },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function listRecentlyDecidedTasks(actor: Actor, take = 10) {
  return prisma.workflowTask.findMany({
    where: { AND: [taskScope(actor), { status: { not: 'PENDING' } }] },
    include: {
      instance: {
        include: { person: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
    orderBy: { decidedAt: 'desc' },
    take,
  });
}

/**
 * Re-read a task through the actor's scope before acting on it.
 *
 * Holding a task id is not the same as being allowed to decide it, so the
 * decision path resolves the task this way rather than trusting the form.
 */
export async function findDecidableTask(actor: Actor, taskId: string) {
  const task = await prisma.workflowTask.findFirst({
    where: { AND: [taskScope(actor), { id: taskId }] },
    select: { id: true, status: true, assigneeId: true },
  });

  if (!task) return { task: null, reason: 'not_found' as const };
  if (!isAdmin(actor) && task.assigneeId !== actor.userId) {
    return { task: null, reason: 'forbidden' as const };
  }
  if (task.status !== 'PENDING') return { task: null, reason: 'already_decided' as const };

  return { task, reason: null };
}
