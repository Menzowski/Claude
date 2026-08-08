import { cache } from 'react';
import { prisma } from '@/lib/db';
import { auth } from './config';
import type { Actor } from '@/lib/authz/scope';

/**
 * Resolve the signed-in user into the `Actor` the authorization layer consumes.
 *
 * Roles are read from the database on every request rather than carried in the
 * session token: revoking a role has to take effect immediately, not whenever
 * the user's JWT happens to expire.
 *
 * Wrapped in React's `cache` so a page rendering several server components
 * resolves the actor once per request.
 */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findFirst({
    where: { id: userId, active: true },
    include: {
      roleAssignments: { select: { role: true, vendorCompanyId: true } },
    },
  });

  if (!user) return null;

  return {
    userId: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    roles: user.roleAssignments.map((r) => ({
      role: r.role,
      vendorCompanyId: r.vendorCompanyId,
    })),
  };
});

export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor() {
    super('Authentication required');
    this.name = 'UnauthenticatedError';
  }
}

/** Actor or 401. Use in server components and actions that require a session. */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}
