import type { Prisma, Role } from '@prisma/client';

/**
 * The authorization chokepoint.
 *
 * Every read of a scoped entity composes a `where` fragment produced here.
 * The point is that a vendor administrator cannot *express* a query that
 * reaches another vendor's records — isolation is a property of the query
 * builder, not of each route remembering to filter.
 *
 * Rules:
 *   IAM_ADMIN    organization-wide, read and write
 *   AUDITOR      organization-wide, read only (plus the audit log)
 *   SPONSOR      organization-wide read of people, write only where they are
 *                the sponsor
 *   VENDOR_ADMIN strictly their own vendor company, nothing else
 */

export type ScopedRole = {
  role: Role;
  vendorCompanyId: string | null;
};

export type Actor = {
  userId: string;
  organizationId: string;
  email: string;
  name: string;
  roles: ScopedRole[];
};

/** An actor with no roles at all — used for unauthenticated/denied paths. */
export function anonymousActor(organizationId: string): Actor {
  return {
    userId: '',
    organizationId,
    email: '',
    name: '',
    roles: [],
  };
}

export function hasRole(actor: Actor, role: Role): boolean {
  return actor.roles.some((r) => r.role === role);
}

export function isAdmin(actor: Actor): boolean {
  return hasRole(actor, 'IAM_ADMIN');
}

export function isAuditor(actor: Actor): boolean {
  return hasRole(actor, 'AUDITOR');
}

/** Vendor companies this actor administers. Empty for internal-only actors. */
export function vendorScopes(actor: Actor): string[] {
  return actor.roles
    .filter((r) => r.role === 'VENDOR_ADMIN' && r.vendorCompanyId)
    .map((r) => r.vendorCompanyId as string);
}

/** True when every role the actor holds is vendor-scoped. */
export function isVendorOnly(actor: Actor): boolean {
  return actor.roles.length > 0 && actor.roles.every((r) => r.role === 'VENDOR_ADMIN');
}

/**
 * A `where` fragment that never matches. Returned instead of throwing so that
 * list endpoints degrade to "no results" rather than leaking existence through
 * a distinguishable error.
 */
const MATCH_NOTHING = { id: '__no_match__' } as const;

/**
 * Scope filter for `Person` reads.
 *
 * Always anchored on organizationId, then narrowed by role. Callers compose it:
 *
 *   prisma.person.findMany({ where: { AND: [personScope(actor), userFilters] } })
 */
export function personScope(actor: Actor): Prisma.PersonWhereInput {
  const base: Prisma.PersonWhereInput = {
    organizationId: actor.organizationId,
    archivedAt: null,
  };

  if (isAdmin(actor) || isAuditor(actor)) return base;

  const vendors = vendorScopes(actor);

  if (isVendorOnly(actor)) {
    // Vendor administrators see their own vendor's people and nothing else.
    // An empty vendor list means the assignment is malformed; deny.
    if (vendors.length === 0) return MATCH_NOTHING;
    return { ...base, vendorCompanyId: { in: vendors } };
  }

  if (hasRole(actor, 'SPONSOR')) {
    // Sponsors read organization-wide (they need to find existing people
    // before creating duplicates) but write only their own — see canWritePerson.
    return base;
  }

  return MATCH_NOTHING;
}

/** Scope filter for `VendorCompany` reads. */
export function vendorScope(actor: Actor): Prisma.VendorCompanyWhereInput {
  const base: Prisma.VendorCompanyWhereInput = {
    organizationId: actor.organizationId,
  };

  if (isAdmin(actor) || isAuditor(actor) || hasRole(actor, 'SPONSOR')) return base;

  const vendors = vendorScopes(actor);
  if (vendors.length === 0) return { id: '__no_match__' };
  return { ...base, id: { in: vendors } };
}

/** Scope filter for `WorkflowTask` reads — an actor sees tasks assigned to them. */
export function taskScope(actor: Actor): Prisma.WorkflowTaskWhereInput {
  const base: Prisma.WorkflowTaskWhereInput = {
    instance: { person: personScope(actor) },
  };

  // Admins oversee the whole queue; everyone else sees only their own tasks.
  if (isAdmin(actor)) return base;
  return { AND: [base, { assigneeId: actor.userId }] };
}

/** Scope filter for `AuditEvent` reads. Only admins and auditors may query it. */
export function auditScope(actor: Actor): Prisma.AuditEventWhereInput {
  if (isAdmin(actor) || isAuditor(actor)) {
    return { organizationId: actor.organizationId };
  }
  return { id: '__no_match__' };
}

// ---------------------------------------------------------------------------
// Write permissions
// ---------------------------------------------------------------------------

export type PersonWriteSubject = {
  sponsorUserId: string | null;
  vendorCompanyId: string | null;
  organizationId: string;
};

/** Whether the actor may modify an existing person. */
export function canWritePerson(actor: Actor, person: PersonWriteSubject): boolean {
  if (person.organizationId !== actor.organizationId) return false;
  if (isAdmin(actor)) return true;

  if (isVendorOnly(actor)) {
    return (
      person.vendorCompanyId !== null &&
      vendorScopes(actor).includes(person.vendorCompanyId)
    );
  }

  if (hasRole(actor, 'SPONSOR')) return person.sponsorUserId === actor.userId;

  return false;
}

/** Whether the actor may create a person against the given vendor. */
export function canCreatePerson(
  actor: Actor,
  vendorCompanyId: string | null,
): boolean {
  if (isAdmin(actor)) return true;

  if (isVendorOnly(actor)) {
    return vendorCompanyId !== null && vendorScopes(actor).includes(vendorCompanyId);
  }

  return hasRole(actor, 'SPONSOR');
}

/** Only administrators configure the platform itself. */
export function canManageConfiguration(actor: Actor): boolean {
  return isAdmin(actor);
}

/** Whether unmasked sensitive attribute values may be shown to this actor. */
export function canRevealSensitive(actor: Actor): boolean {
  return isAdmin(actor) || isAuditor(actor);
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) throw new ForbiddenError(message);
}
