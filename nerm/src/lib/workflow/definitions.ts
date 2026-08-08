import { prisma } from '@/lib/db';
import { writeAudit, type AuditActor } from '@/lib/audit';
import { canTransition } from '@/lib/domain/lifecycle';
import { validateExpression } from './evaluator';
import {
  formatIssues,
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from './schema';

/**
 * Publishing and versioning of workflow definitions.
 *
 * Published versions are immutable. `publish` always writes a new version;
 * `activate` chooses which version new instances start on. That gives a
 * git-diffable history, safe promotion between environments, and in-flight
 * instances that cannot be disturbed by an edit.
 */

export type ValidationIssue = { path: string; message: string };

export type ValidationResult =
  | { valid: true; definition: WorkflowDefinition; warnings: ValidationIssue[] }
  | { valid: false; errors: ValidationIssue[] };

/**
 * Structural validation (Zod) plus the semantic checks Zod cannot express:
 * that condition expressions parse, and that `transition` stages name edges
 * the lifecycle state machine actually has.
 */
export function validateDefinition(input: unknown): ValidationResult {
  const parsed = workflowDefinitionSchema.safeParse(input);
  if (!parsed.success) return { valid: false, errors: formatIssues(parsed.error) };

  const definition = parsed.data;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (definition.trigger.when) {
    const result = validateExpression(definition.trigger.when);
    if (!result.valid) {
      errors.push({ path: 'trigger.when', message: result.error ?? 'Invalid expression' });
    }
  }

  definition.stages.forEach((stage, index) => {
    if (stage.when) {
      const result = validateExpression(stage.when);
      if (!result.valid) {
        errors.push({
          path: `stages.${index}.when`,
          message: result.error ?? 'Invalid expression',
        });
      }
    }
  });

  // A `transition` stage must be reachable from at least one state the person
  // could plausibly be in. Catching this at publish time beats discovering it
  // as a failed instance three weeks later.
  definition.stages.forEach((stage, index) => {
    if (stage.type !== 'transition') return;
    const reachable = (
      ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'EXPIRING', 'SUSPENDED', 'INACTIVE'] as const
    ).some((from) => canTransition(from, stage.to));

    if (!reachable) {
      errors.push({
        path: `stages.${index}.to`,
        message: `No lifecycle transition leads to ${stage.to}; this stage can never succeed`,
      });
    }
  });

  const blocking = definition.stages.filter((s) =>
    ['approval', 'document', 'task'].includes(s.type),
  );
  if (blocking.length === 0) {
    warnings.push({
      path: 'stages',
      message: 'This workflow has no human step and will complete immediately',
    });
  }

  if (!definition.stages.some((s) => s.type === 'transition')) {
    warnings.push({
      path: 'stages',
      message: 'This workflow never changes the lifecycle state of the person',
    });
  }

  return errors.length ? { valid: false, errors } : { valid: true, definition, warnings };
}

export class DefinitionError extends Error {
  readonly status = 400;
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'DefinitionError';
  }
}

/**
 * Publish a definition as a new version. The first version of a key is
 * activated automatically; later versions must be activated explicitly so that
 * publishing is never accidentally a production change.
 */
export async function publishDefinition(params: {
  organizationId: string;
  input: unknown;
  actor: AuditActor;
}): Promise<{ id: string; key: string; version: number; active: boolean }> {
  const result = validateDefinition(params.input);
  if (!result.valid) throw new DefinitionError('Workflow definition is invalid', result.errors);

  const { definition } = result;

  const latest = await prisma.workflowDefinition.findFirst({
    where: { organizationId: params.organizationId, key: definition.key },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const version = (latest?.version ?? 0) + 1;
  const isFirst = latest === null;

  const record = await prisma.workflowDefinition.create({
    data: {
      organizationId: params.organizationId,
      key: definition.key,
      version,
      name: definition.name,
      description: definition.description ?? null,
      definition: definition as unknown as object,
      active: isFirst,
      createdBy: params.actor.id ?? null,
    },
  });

  await writeAudit({
    organizationId: params.organizationId,
    action: 'workflow.definition.published',
    actor: params.actor,
    subjectType: 'WorkflowDefinition',
    subjectId: record.id,
    metadata: { key: definition.key, version, activatedImmediately: isFirst },
  });

  return { id: record.id, key: record.key, version: record.version, active: record.active };
}

/**
 * Make one version the active one for its key. Deactivating the previous
 * version and activating the new one happen together, so there is never a
 * moment with two active versions or none.
 */
export async function activateVersion(params: {
  organizationId: string;
  key: string;
  version: number;
  actor: AuditActor;
}): Promise<void> {
  const target = await prisma.workflowDefinition.findFirst({
    where: {
      organizationId: params.organizationId,
      key: params.key,
      version: params.version,
    },
  });

  if (!target) throw new DefinitionError(`No version ${params.version} of "${params.key}"`);

  await prisma.$transaction(async (tx) => {
    await tx.workflowDefinition.updateMany({
      where: { organizationId: params.organizationId, key: params.key, active: true },
      data: { active: false },
    });

    await tx.workflowDefinition.update({
      where: { id: target.id },
      data: { active: true },
    });

    await writeAudit(
      {
        organizationId: params.organizationId,
        action: 'workflow.definition.activated',
        actor: params.actor,
        subjectType: 'WorkflowDefinition',
        subjectId: target.id,
        metadata: { key: params.key, version: params.version },
      },
      tx,
    );
  });
}

/** Latest version of every key, with the active version flagged. */
export async function listDefinitions(organizationId: string) {
  const rows = await prisma.workflowDefinition.findMany({
    where: { organizationId },
    orderBy: [{ key: 'asc' }, { version: 'desc' }],
    select: {
      id: true,
      key: true,
      version: true,
      name: true,
      description: true,
      active: true,
      createdAt: true,
    },
  });

  const byKey = new Map<string, (typeof rows)[number] & { activeVersion: number | null }>();
  for (const row of rows) {
    const existing = byKey.get(row.key);
    if (!existing) {
      byKey.set(row.key, { ...row, activeVersion: row.active ? row.version : null });
    } else if (row.active) {
      existing.activeVersion = row.version;
    }
  }

  return [...byKey.values()];
}

export async function getVersions(organizationId: string, key: string) {
  return prisma.workflowDefinition.findMany({
    where: { organizationId, key },
    orderBy: { version: 'desc' },
  });
}

export async function getVersion(organizationId: string, key: string, version: number) {
  return prisma.workflowDefinition.findFirst({
    where: { organizationId, key, version },
  });
}

export async function getActiveDefinition(organizationId: string, key: string) {
  return prisma.workflowDefinition.findFirst({
    where: { organizationId, key, active: true },
  });
}
