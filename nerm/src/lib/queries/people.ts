import type { LifecycleState, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  canRevealSensitive,
  personScope,
  type Actor,
} from '@/lib/authz/scope';

/** Scoped person reads, with sensitive attribute values masked per actor. */

export type PeopleFilters = {
  q?: string;
  state?: LifecycleState;
  vendorId?: string;
  expiring?: boolean;
  page?: number;
  perPage?: number;
};

export async function listPeople(actor: Actor, filters: PeopleFilters = {}) {
  const perPage = Math.min(filters.perPage ?? 25, 100);
  const page = Math.max(filters.page ?? 1, 1);

  const conditions: Prisma.PersonWhereInput[] = [personScope(actor)];

  if (filters.q) {
    conditions.push({
      OR: [
        { firstName: { contains: filters.q, mode: 'insensitive' } },
        { lastName: { contains: filters.q, mode: 'insensitive' } },
        { email: { contains: filters.q, mode: 'insensitive' } },
        { jobTitle: { contains: filters.q, mode: 'insensitive' } },
      ],
    });
  }

  if (filters.state) conditions.push({ lifecycleState: filters.state });
  if (filters.vendorId) conditions.push({ vendorCompanyId: filters.vendorId });

  if (filters.expiring) {
    const until = new Date();
    until.setDate(until.getDate() + 30);
    conditions.push({
      lifecycleState: { in: ['ACTIVE', 'EXPIRING'] },
      endDate: { lte: until },
    });
  }

  const where: Prisma.PersonWhereInput = { AND: conditions };

  const [total, people] = await Promise.all([
    prisma.person.count({ where }),
    prisma.person.findMany({
      where,
      include: {
        vendorCompany: { select: { id: true, name: true } },
        sponsor: { select: { id: true, name: true } },
        profileType: { select: { name: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return { people, total, page, perPage, pages: Math.max(Math.ceil(total / perPage), 1) };
}

const MASK = '••••••';

export type PersonAttribute = {
  key: string;
  label: string;
  value: string;
  masked: boolean;
  helpText: string | null;
};

/**
 * A person with their custom attributes resolved, masking values whose
 * definition marks them PII unless the actor is entitled to see them.
 *
 * Masking happens here rather than in the view so that a new page cannot
 * accidentally render an unmasked value by fetching the raw row itself.
 */
export async function getPerson(actor: Actor, personId: string) {
  const person = await prisma.person.findFirst({
    where: { AND: [personScope(actor), { id: personId }] },
    include: {
      vendorCompany: { select: { id: true, name: true } },
      sponsor: { select: { id: true, name: true, email: true } },
      profileType: { select: { id: true, name: true, key: true } },
      attributes: { include: { definition: true } },
      transitions: { orderBy: { createdAt: 'desc' }, take: 50 },
      workflows: {
        include: {
          definition: { select: { key: true, name: true, version: true } },
          tasks: {
            include: { assignee: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { startedAt: 'desc' },
      },
      attachments: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!person) return null;

  const reveal = canRevealSensitive(actor);

  const attributes: PersonAttribute[] = person.attributes
    .sort((a, b) => a.definition.order - b.definition.order)
    .map((value) => {
      const sensitive =
        value.definition.sensitivity === 'PII' ||
        value.definition.sensitivity === 'SENSITIVE_PII';

      const raw =
        value.stringValue ??
        (value.numberValue !== null ? String(value.numberValue) : null) ??
        (value.boolValue !== null ? (value.boolValue ? 'Yes' : 'No') : null) ??
        (value.dateValue ? value.dateValue.toLocaleDateString('en-GB') : null) ??
        '—';

      const masked = sensitive && !reveal && raw !== '—';

      return {
        key: value.definition.key,
        label: value.definition.label,
        value: masked ? MASK : raw,
        masked,
        helpText: value.definition.helpText,
      };
    });

  return { ...person, resolvedAttributes: attributes };
}

export type PersonDetail = NonNullable<Awaited<ReturnType<typeof getPerson>>>;

/** Profile types with their attribute schema, for rendering dynamic forms. */
export async function getProfileTypes(organizationId: string) {
  return prisma.profileType.findMany({
    where: { organizationId, active: true },
    include: { attributes: { orderBy: { order: 'asc' } } },
    orderBy: { name: 'asc' },
  });
}

/** Internal users who can be named as a sponsor. */
export async function getSponsorOptions(organizationId: string) {
  return prisma.user.findMany({
    where: {
      organizationId,
      kind: 'INTERNAL',
      active: true,
      roleAssignments: { some: { role: { in: ['SPONSOR', 'IAM_ADMIN'] } } },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
}
