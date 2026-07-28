import { prisma } from '@/lib/db';
import { personScope, vendorScope, vendorScopes, type Actor } from '@/lib/authz/scope';

/** Scoped vendor reads. */

/** Active vendors the actor may assign someone to. */
export async function listAssignableVendors(actor: Actor) {
  return prisma.vendorCompany.findMany({
    where: { AND: [vendorScope(actor), { status: 'ACTIVE' }] },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

/** Full vendor records with administrators and headcount, for the admin console. */
export async function listVendorsWithAdministrators(actor: Actor) {
  return prisma.vendorCompany.findMany({
    where: vendorScope(actor),
    include: {
      owner: { select: { name: true, email: true } },
      _count: { select: { people: true } },
      assignments: {
        where: { role: 'VENDOR_ADMIN' },
        include: { user: { select: { name: true, email: true, lastLoginAt: true } } },
      },
    },
    orderBy: { name: 'asc' },
  });
}

/** The vendor portal home: the administrator's own companies and their roster. */
export async function getVendorPortalData(actor: Actor) {
  const [vendors, people] = await Promise.all([
    prisma.vendorCompany.findMany({
      where: {
        id: { in: vendorScopes(actor) },
        organizationId: actor.organizationId,
      },
      select: { id: true, name: true, contractEnd: true, status: true },
    }),
    prisma.person.findMany({
      where: personScope(actor),
      include: { sponsor: { select: { name: true } } },
      orderBy: [{ lifecycleState: 'asc' }, { endDate: 'asc' }],
    }),
  ]);

  return { vendors, people };
}

/** The internal owner of a vendor, used to route vendor submissions. */
export async function getVendorOwner(vendorCompanyId: string) {
  const vendor = await prisma.vendorCompany.findUnique({
    where: { id: vendorCompanyId },
    select: { ownerUserId: true },
  });
  return vendor?.ownerUserId ?? null;
}
