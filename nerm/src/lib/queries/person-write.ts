import { prisma } from '@/lib/db';
import { personScope, type Actor } from '@/lib/authz/scope';

/**
 * Lookups used by the write paths.
 *
 * These live beside the other query modules so that server actions never touch
 * the Prisma client directly — an action that builds its own `where` clause is
 * exactly how vendor isolation gets lost.
 */

/** A profile type with its attribute schema, scoped to the actor's organization. */
export async function findProfileType(actor: Actor, profileTypeId: string) {
  return prisma.profileType.findFirst({
    where: { id: profileTypeId, organizationId: actor.organizationId },
    include: { attributes: true },
  });
}

/** A person the actor is allowed to see, with the fields write checks need. */
export async function findWritablePerson(actor: Actor, personId: string) {
  return prisma.person.findFirst({
    where: { AND: [personScope(actor), { id: personId }] },
    select: {
      id: true,
      organizationId: true,
      sponsorUserId: true,
      vendorCompanyId: true,
      lifecycleState: true,
    },
  });
}
