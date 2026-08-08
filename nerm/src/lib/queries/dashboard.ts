import { prisma } from '@/lib/db';
import { personScope, taskScope, isAdmin, hasRole, type Actor } from '@/lib/authz/scope';

/**
 * Dashboard reads. Every query composes the scope fragment from
 * `@/lib/authz/scope`, so what a sponsor sees and what a vendor administrator
 * sees differ by the filter, not by a separate code path.
 */

export async function getDashboard(actor: Actor) {
  const scope = personScope(actor);
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);

  // A sponsor's home should lead with their own people, not the whole org.
  const mine = hasRole(actor, 'SPONSOR') && !isAdmin(actor) ? { sponsorUserId: actor.userId } : {};

  const [total, active, pending, expiring, myPeople, myTasks] = await Promise.all([
    prisma.person.count({ where: scope }),
    prisma.person.count({ where: { AND: [scope, { lifecycleState: 'ACTIVE' }] } }),
    prisma.person.count({ where: { AND: [scope, { lifecycleState: 'PENDING_APPROVAL' }] } }),
    prisma.person.count({
      where: {
        AND: [scope, { lifecycleState: { in: ['ACTIVE', 'EXPIRING'] } }, { endDate: { lte: soon, gte: new Date() } }],
      },
    }),
    prisma.person.findMany({
      where: { AND: [scope, mine] },
      include: { vendorCompany: { select: { name: true } } },
      orderBy: [{ endDate: 'asc' }, { updatedAt: 'desc' }],
      take: 8,
    }),
    prisma.workflowTask.findMany({
      where: { AND: [taskScope(actor), { status: 'PENDING' }] },
      include: {
        instance: {
          include: {
            person: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: [{ dueAt: 'asc' }],
      take: 8,
    }),
  ]);

  return { total, active, pending, expiring, myPeople, myTasks };
}

/** People whose access lapses inside the warning window, soonest first. */
export async function getExpiring(actor: Actor, days = 30) {
  const until = new Date();
  until.setDate(until.getDate() + days);

  return prisma.person.findMany({
    where: {
      AND: [
        personScope(actor),
        { lifecycleState: { in: ['ACTIVE', 'EXPIRING'] } },
        { endDate: { lte: until } },
      ],
    },
    include: { vendorCompany: { select: { name: true } }, sponsor: { select: { name: true } } },
    orderBy: { endDate: 'asc' },
    take: 20,
  });
}
