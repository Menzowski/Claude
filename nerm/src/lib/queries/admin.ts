import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auditScope, canManageConfiguration, type Actor } from '@/lib/authz/scope';

/** Reads for the audit log and the administration console. */

export type AuditFilters = { action?: string; subjectType?: string; page?: number };

export async function listAuditEvents(actor: Actor, filters: AuditFilters = {}) {
  const perPage = 50;
  const page = Math.max(filters.page ?? 1, 1);

  const where: Prisma.AuditEventWhereInput = {
    AND: [
      auditScope(actor),
      ...(filters.action ? [{ action: { contains: filters.action } }] : []),
      ...(filters.subjectType ? [{ subjectType: filters.subjectType }] : []),
    ],
  };

  const [total, events] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return { events, total, page, pages: Math.max(Math.ceil(total / perPage), 1) };
}

/** API clients. Only ever the digest and prefix — no path returns a token. */
export async function listApiClients(actor: Actor) {
  if (!canManageConfiguration(actor)) return [];

  return prisma.apiClient.findMany({
    where: { organizationId: actor.organizationId },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      active: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** Active workflow definitions, for showing what a profile type will trigger. */
export async function listActiveWorkflows(organizationId: string) {
  return prisma.workflowDefinition.findMany({
    where: { organizationId, active: true },
    select: { key: true, name: true, description: true },
  });
}
