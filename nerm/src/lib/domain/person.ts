import type { AttributeKind, Person, PersonType, Prisma, RiskTier } from '@prisma/client';
import { prisma } from '@/lib/db';
import { diffRecords, writeAudit, type AuditActor } from '@/lib/audit';
import { startWorkflow } from '@/lib/workflow/engine';

/**
 * Person creation and update.
 *
 * Custom attributes are validated against the profile type's
 * `AttributeDefinition` rows, so what counts as a valid profile is
 * configuration rather than code. Every write is audited with sensitive fields
 * masked.
 */

export type AttributeInput = Record<string, string | number | boolean | null>;

export type CreatePersonInput = {
  organizationId: string;
  profileTypeId: string;
  type: PersonType;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle?: string | null;
  department?: string | null;
  location?: string | null;
  riskTier?: RiskTier;
  startDate?: Date | null;
  endDate?: Date | null;
  sponsorUserId?: string | null;
  vendorCompanyId?: string | null;
  externalId?: string;
  attributes?: AttributeInput;
};

export class ValidationError extends Error {
  readonly status = 400;
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate submitted attribute values against the profile type's definitions.
 * Returns rows ready to write, or throws with per-field issues.
 */
export async function validateAttributes(
  profileTypeId: string,
  input: AttributeInput,
  { partial = false }: { partial?: boolean } = {},
): Promise<{ definitionId: string; data: Prisma.AttributeValueCreateWithoutPersonInput }[]> {
  const definitions = await prisma.attributeDefinition.findMany({
    where: { profileTypeId },
  });

  const byKey = new Map(definitions.map((d) => [d.key, d]));
  const issues: { path: string; message: string }[] = [];
  const rows: {
    definitionId: string;
    data: Prisma.AttributeValueCreateWithoutPersonInput;
  }[] = [];

  for (const key of Object.keys(input)) {
    if (!byKey.has(key)) {
      issues.push({ path: key, message: `Unknown attribute "${key}" for this profile type` });
    }
  }

  for (const definition of definitions) {
    const provided = Object.prototype.hasOwnProperty.call(input, definition.key);
    const raw = input[definition.key];

    if (!provided) {
      if (definition.required && !partial) {
        issues.push({ path: definition.key, message: `${definition.label} is required` });
      }
      continue;
    }

    if (raw === null || raw === undefined || raw === '') {
      if (definition.required) {
        issues.push({ path: definition.key, message: `${definition.label} is required` });
        continue;
      }
      rows.push({
        definitionId: definition.id,
        data: {
          definition: { connect: { id: definition.id } },
          stringValue: null,
          numberValue: null,
          boolValue: null,
          dateValue: null,
        },
      });
      continue;
    }

    const coerced = coerce(definition.kind, raw);
    if (coerced === undefined) {
      issues.push({
        path: definition.key,
        message: `${definition.label} must be a valid ${definition.kind.toLowerCase()}`,
      });
      continue;
    }

    const validationIssue = applyValidation(definition, coerced);
    if (validationIssue) {
      issues.push({ path: definition.key, message: validationIssue });
      continue;
    }

    rows.push({
      definitionId: definition.id,
      data: {
        definition: { connect: { id: definition.id } },
        stringValue: typeof coerced === 'string' ? coerced : null,
        numberValue: typeof coerced === 'number' ? coerced : null,
        boolValue: typeof coerced === 'boolean' ? coerced : null,
        dateValue: coerced instanceof Date ? coerced : null,
      },
    });
  }

  if (issues.length) throw new ValidationError('Attribute validation failed', issues);
  return rows;
}

function coerce(
  kind: AttributeKind,
  raw: string | number | boolean,
): string | number | boolean | Date | undefined {
  switch (kind) {
    case 'NUMBER': {
      const value = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(value) ? value : undefined;
    }
    case 'BOOLEAN':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return undefined;
    case 'DATE': {
      const date = new Date(String(raw));
      return Number.isNaN(date.getTime()) ? undefined : date;
    }
    case 'EMAIL': {
      const value = String(raw).trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : undefined;
    }
    default:
      return String(raw);
  }
}

function applyValidation(
  definition: { label: string; options: unknown; validation: unknown; kind: AttributeKind },
  value: string | number | boolean | Date,
): string | null {
  if (definition.kind === 'SELECT' && Array.isArray(definition.options)) {
    const allowed = (definition.options as { value: string }[]).map((o) => o.value);
    if (!allowed.includes(String(value))) {
      return `${definition.label} must be one of: ${allowed.join(', ')}`;
    }
  }

  const rules = (definition.validation ?? {}) as {
    min?: number;
    max?: number;
    maxLength?: number;
    pattern?: string;
  };

  if (typeof value === 'number') {
    if (rules.min !== undefined && value < rules.min) {
      return `${definition.label} must be at least ${rules.min}`;
    }
    if (rules.max !== undefined && value > rules.max) {
      return `${definition.label} must be at most ${rules.max}`;
    }
  }

  if (typeof value === 'string') {
    if (rules.maxLength !== undefined && value.length > rules.maxLength) {
      return `${definition.label} must be ${rules.maxLength} characters or fewer`;
    }
    if (rules.pattern) {
      try {
        if (!new RegExp(rules.pattern).test(value)) {
          return `${definition.label} is not in the expected format`;
        }
      } catch {
        // A malformed configured pattern must not block a user's submission.
        return null;
      }
    }
  }

  return null;
}

/** Field names masked in audit diffs. */
const SENSITIVE_CORE_FIELDS = ['email'] as const;

export type CreatePersonOptions = {
  startWorkflows?: boolean;
  /**
   * Skip the required-attribute check.
   *
   * Inbound SCIM provisioning uses this. A SCIM client has no way to know that
   * this organization has configured "cost centre" as mandatory, so enforcing
   * it at the API boundary would make inbound provisioning impossible for any
   * profile type with required custom attributes. Instead the record lands in
   * DRAFT and a sponsor completes it before it can be submitted — the
   * requirement is enforced where someone can actually satisfy it.
   */
  allowIncompleteAttributes?: boolean;
};

export async function createPerson(
  input: CreatePersonInput,
  actor: AuditActor,
  { startWorkflows = true, allowIncompleteAttributes = false }: CreatePersonOptions = {},
): Promise<Person> {
  const email = input.email.trim().toLowerCase();

  const duplicate = await prisma.person.findFirst({
    where: { organizationId: input.organizationId, email },
    select: { id: true },
  });
  if (duplicate) {
    throw new ValidationError('A person with this email already exists', [
      { path: 'email', message: 'Already in use' },
    ]);
  }

  const attributeRows = await validateAttributes(
    input.profileTypeId,
    input.attributes ?? {},
    { partial: allowIncompleteAttributes },
  );

  const person = await prisma.$transaction(async (tx) => {
    const created = await tx.person.create({
      data: {
        organizationId: input.organizationId,
        profileTypeId: input.profileTypeId,
        type: input.type,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        email,
        jobTitle: input.jobTitle ?? null,
        department: input.department ?? null,
        location: input.location ?? null,
        riskTier: input.riskTier ?? 'LOW',
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        sponsorUserId: input.sponsorUserId ?? null,
        vendorCompanyId: input.vendorCompanyId ?? null,
        ...(input.externalId ? { externalId: input.externalId } : {}),
        attributes: {
          create: attributeRows.map((row) => row.data),
        },
      },
    });

    await writeAudit(
      {
        organizationId: input.organizationId,
        action: 'person.created',
        actor,
        subjectType: 'Person',
        subjectId: created.id,
        changes: diffRecords(
          null,
          {
            firstName: created.firstName,
            lastName: created.lastName,
            email: created.email,
            type: created.type,
            lifecycleState: created.lifecycleState,
          },
          SENSITIVE_CORE_FIELDS,
        ),
      },
      tx,
    );

    return created;
  });

  if (startWorkflows) {
    await startWorkflow({ personId: person.id, event: 'person.created', actor });
  }

  return person;
}

export type UpdatePersonInput = Partial<
  Pick<
    CreatePersonInput,
    | 'firstName'
    | 'lastName'
    | 'email'
    | 'jobTitle'
    | 'department'
    | 'location'
    | 'riskTier'
    | 'startDate'
    | 'endDate'
    | 'sponsorUserId'
    | 'vendorCompanyId'
    | 'externalId'
  >
> & { attributes?: AttributeInput };

export async function updatePerson(
  personId: string,
  input: UpdatePersonInput,
  actor: AuditActor,
): Promise<Person> {
  const existing = await prisma.person.findUniqueOrThrow({ where: { id: personId } });

  const attributeRows = input.attributes
    ? await validateAttributes(existing.profileTypeId, input.attributes, { partial: true })
    : [];

  const data: Prisma.PersonUpdateInput = {};
  if (input.firstName !== undefined) data.firstName = input.firstName.trim();
  if (input.lastName !== undefined) data.lastName = input.lastName.trim();
  if (input.email !== undefined) data.email = input.email.trim().toLowerCase();
  if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle;
  if (input.department !== undefined) data.department = input.department;
  if (input.location !== undefined) data.location = input.location;
  if (input.riskTier !== undefined) data.riskTier = input.riskTier;
  if (input.startDate !== undefined) data.startDate = input.startDate;
  if (input.endDate !== undefined) data.endDate = input.endDate;
  if (input.externalId !== undefined) data.externalId = input.externalId;
  if (input.sponsorUserId !== undefined) {
    data.sponsor = input.sponsorUserId
      ? { connect: { id: input.sponsorUserId } }
      : { disconnect: true };
  }
  if (input.vendorCompanyId !== undefined) {
    data.vendorCompany = input.vendorCompanyId
      ? { connect: { id: input.vendorCompanyId } }
      : { disconnect: true };
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.person.update({ where: { id: personId }, data });

    for (const row of attributeRows) {
      await tx.attributeValue.upsert({
        where: {
          personId_definitionId: { personId, definitionId: row.definitionId },
        },
        create: { ...row.data, person: { connect: { id: personId } } },
        update: {
          stringValue: row.data.stringValue ?? null,
          numberValue: row.data.numberValue ?? null,
          boolValue: row.data.boolValue ?? null,
          dateValue: row.data.dateValue ?? null,
        },
      });
    }

    const changes = diffRecords(
      pickAudited(existing),
      pickAudited(updated),
      SENSITIVE_CORE_FIELDS,
    );

    if (changes.length || attributeRows.length) {
      await writeAudit(
        {
          organizationId: existing.organizationId,
          action: 'person.updated',
          actor,
          subjectType: 'Person',
          subjectId: personId,
          changes,
          metadata: attributeRows.length
            ? { attributesChanged: attributeRows.length }
            : undefined,
        },
        tx,
      );
    }

    return updated;
  });
}

function pickAudited(person: Person): Record<string, unknown> {
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    email: person.email,
    jobTitle: person.jobTitle,
    department: person.department,
    location: person.location,
    riskTier: person.riskTier,
    startDate: person.startDate,
    endDate: person.endDate,
    sponsorUserId: person.sponsorUserId,
    vendorCompanyId: person.vendorCompanyId,
  };
}
