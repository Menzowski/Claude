import type { ActorKind, Prisma, Sensitivity } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Append-only audit log.
 *
 * This module deliberately exposes only a write function and readers. There is
 * no update or delete path anywhere in the codebase, and the migration in
 * `prisma/migrations/*_audit_append_only` revokes UPDATE and DELETE on the
 * table from the application role so a future mistake cannot quietly rewrite
 * history.
 */

export type AuditActor = {
  kind: ActorKind;
  id?: string | null;
  label?: string | null;
};

export type AuditChange = {
  field: string;
  from: unknown;
  to: unknown;
};

export type WriteAuditInput = {
  organizationId: string;
  action: string;
  actor: AuditActor;
  subjectType: string;
  subjectId?: string | null;
  changes?: AuditChange[];
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const MASK = '••••••';

/** Values at or above this sensitivity are masked in stored audit diffs. */
const MASKED_SENSITIVITIES: readonly Sensitivity[] = ['PII', 'SENSITIVE_PII'];

export function shouldMask(sensitivity: Sensitivity): boolean {
  return MASKED_SENSITIVITIES.includes(sensitivity);
}

/**
 * Replace a value with a mask while preserving whether it was set. Auditors
 * need to know that a national ID changed without the log itself becoming a
 * second copy of everyone's national ID.
 */
export function maskValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return MASK;
}

/**
 * Build a field-level diff between two records, masking fields named in
 * `sensitiveFields`. Only changed fields are returned.
 */
export function diffRecords(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  sensitiveFields: readonly string[] = [],
): AuditChange[] {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const sensitive = new Set(sensitiveFields);
  const changes: AuditChange[] = [];

  for (const field of keys) {
    const from = before?.[field] ?? null;
    const to = after?.[field] ?? null;
    if (serialize(from) === serialize(to)) continue;

    changes.push(
      sensitive.has(field)
        ? { field, from: maskValue(from), to: maskValue(to) }
        : { field, from: normalize(from), to: normalize(to) },
    );
  }

  return changes;
}

function normalize(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

function serialize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

/**
 * Write an audit event. Accepts an optional transaction client so a mutation
 * and its audit record commit together — an audit log that can disagree with
 * the data it describes is worse than none.
 */
export async function writeAudit(
  input: WriteAuditInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      action: input.action,
      actorKind: input.actor.kind,
      actorId: input.actor.id ?? null,
      actorLabel: input.actor.label ?? null,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      changes: input.changes?.length
        ? (input.changes as unknown as Prisma.InputJsonValue)
        : undefined,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
