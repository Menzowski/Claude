import { createHash } from 'node:crypto';
import type { Person, VendorCompany } from '@prisma/client';
import { isActiveState } from '@/lib/domain/lifecycle';

/**
 * Projection between the domain model and SCIM 2.0 resources.
 *
 * The core schema carries what every SCIM client understands; everything that
 * makes a non-employee a non-employee — vendor, end date, risk tier, lifecycle
 * state — lives in a custom extension so Identity Security Cloud can use those
 * attributes in policy without us abusing core fields to smuggle them across.
 */

export const CORE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const CORE_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const ENTERPRISE_USER_SCHEMA =
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
export const NERM_USER_SCHEMA = 'urn:nerm:2.0:NonEmployee';
export const LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export type ScimUser = Record<string, unknown>;

type PersonForScim = Person & {
  vendorCompany?: Pick<VendorCompany, 'id' | 'name'> | null;
  sponsor?: { id: string; name: string; email: string } | null;
};

/**
 * A weak ETag over the fields SCIM exposes. Clients use this for conditional
 * requests; deriving it from `updatedAt` and `id` keeps it stable without a
 * stored version column.
 */
export function personEtag(person: Pick<Person, 'id' | 'updatedAt'>): string {
  const digest = createHash('sha256')
    .update(`${person.id}:${person.updatedAt.toISOString()}`)
    .digest('hex')
    .slice(0, 32);
  return `W/"${digest}"`;
}

export function toScimUser(person: PersonForScim, baseUrl: string): ScimUser {
  return {
    schemas: [CORE_USER_SCHEMA, ENTERPRISE_USER_SCHEMA, NERM_USER_SCHEMA],
    id: person.id,
    externalId: person.externalId,
    userName: person.email,
    name: {
      givenName: person.firstName,
      familyName: person.lastName,
      formatted: `${person.firstName} ${person.lastName}`,
    },
    displayName: `${person.firstName} ${person.lastName}`,
    title: person.jobTitle ?? undefined,
    // SCIM `active` is derived from lifecycle state — there is no separate
    // stored flag that could disagree with it.
    active: isActiveState(person.lifecycleState),
    emails: [{ value: person.email, primary: true, type: 'work' }],
    [ENTERPRISE_USER_SCHEMA]: {
      department: person.department ?? undefined,
      manager: person.sponsor
        ? {
            value: person.sponsor.id,
            displayName: person.sponsor.name,
            $ref: `${baseUrl}/scim/v2/Users/${person.sponsor.id}`,
          }
        : undefined,
    },
    [NERM_USER_SCHEMA]: {
      personType: person.type,
      lifecycleState: person.lifecycleState,
      riskTier: person.riskTier,
      startDate: person.startDate?.toISOString() ?? null,
      endDate: person.endDate?.toISOString() ?? null,
      location: person.location ?? null,
      vendorCompany: person.vendorCompany
        ? {
            value: person.vendorCompany.id,
            display: person.vendorCompany.name,
            $ref: `${baseUrl}/scim/v2/Groups/${person.vendorCompany.id}`,
          }
        : null,
    },
    meta: {
      resourceType: 'User',
      created: person.createdAt.toISOString(),
      lastModified: person.updatedAt.toISOString(),
      location: `${baseUrl}/scim/v2/Users/${person.id}`,
      version: personEtag(person),
    },
  };
}

type VendorForScim = VendorCompany & { people?: Pick<Person, 'id' | 'email'>[] };

export function toScimGroup(vendor: VendorForScim, baseUrl: string): Record<string, unknown> {
  return {
    schemas: [CORE_GROUP_SCHEMA],
    id: vendor.id,
    externalId: vendor.externalId ?? undefined,
    displayName: vendor.name,
    members:
      vendor.people?.map((person) => ({
        value: person.id,
        display: person.email,
        $ref: `${baseUrl}/scim/v2/Users/${person.id}`,
      })) ?? [],
    meta: {
      resourceType: 'Group',
      created: vendor.createdAt.toISOString(),
      lastModified: vendor.updatedAt.toISOString(),
      location: `${baseUrl}/scim/v2/Groups/${vendor.id}`,
    },
  };
}

export function listResponse(
  resources: unknown[],
  totalResults: number,
  startIndex: number,
  itemsPerPage: number,
): Record<string, unknown> {
  return {
    schemas: [LIST_RESPONSE_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage,
    Resources: resources,
  };
}

export function scimError(
  status: number,
  detail: string,
  scimType?: string,
): Record<string, unknown> {
  return {
    schemas: [ERROR_SCHEMA],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  };
}

// ---------------------------------------------------------------------------
// Inbound mapping
// ---------------------------------------------------------------------------

/** Fields a SCIM client is permitted to write. */
export type ScimUserWrite = {
  email?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string | null;
  department?: string | null;
  location?: string | null;
  externalId?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  /** Requested active state; the caller maps this onto a lifecycle transition. */
  active?: boolean;
  /**
   * Configured custom attributes, keyed by attribute definition key. A client
   * that knows this organization's schema can populate them; one that does not
   * simply omits the object.
   */
  attributes?: Record<string, string | number | boolean | null>;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asDate(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Map an inbound SCIM user representation onto writable domain fields. */
export function fromScimUser(body: Record<string, unknown>): ScimUserWrite {
  const name = (body.name ?? {}) as Record<string, unknown>;
  const emails = Array.isArray(body.emails) ? (body.emails as Record<string, unknown>[]) : [];
  const primaryEmail =
    asString(emails.find((e) => e.primary)?.value) ?? asString(emails[0]?.value);
  const enterprise = (body[ENTERPRISE_USER_SCHEMA] ?? {}) as Record<string, unknown>;
  const nerm = (body[NERM_USER_SCHEMA] ?? {}) as Record<string, unknown>;

  return {
    email: asString(body.userName) ?? primaryEmail,
    firstName: asString(name.givenName),
    lastName: asString(name.familyName),
    jobTitle: asString(body.title) ?? null,
    department: asString(enterprise.department) ?? null,
    location: asString(nerm.location) ?? null,
    externalId: asString(body.externalId),
    startDate: asDate(nerm.startDate),
    endDate: asDate(nerm.endDate),
    active: typeof body.active === 'boolean' ? body.active : undefined,
    attributes: asAttributes(nerm.attributes),
  };
}

function asAttributes(
  value: unknown,
): Record<string, string | number | boolean | null> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (
      raw === null ||
      typeof raw === 'string' ||
      typeof raw === 'number' ||
      typeof raw === 'boolean'
    ) {
      result[key] = raw;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

/**
 * Apply a SCIM PATCH operation set to a plain object representation.
 *
 * Supports the subset RFC 7644 §3.5.2 defines that clients actually send:
 * `replace` and `add` with a simple attribute path, and `remove`. Complex
 * value-filter paths (`emails[type eq "work"].value`) are rejected rather than
 * half-applied.
 */
export type PatchOperation = { op: string; path?: string; value?: unknown };

export class ScimPatchError extends Error {
  readonly status = 400;
  readonly scimType = 'invalidPath';
  constructor(message: string) {
    super(message);
    this.name = 'ScimPatchError';
  }
}

export function applyPatch(
  current: Record<string, unknown>,
  operations: PatchOperation[],
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(current);

  for (const operation of operations) {
    const op = String(operation.op ?? '').toLowerCase();

    if (!['add', 'replace', 'remove'].includes(op)) {
      throw new ScimPatchError(`Unsupported PATCH operation "${operation.op}"`);
    }

    // No path: the value is a partial resource merged at the top level.
    if (!operation.path) {
      if (op === 'remove') throw new ScimPatchError('"remove" requires a path');
      if (typeof operation.value !== 'object' || operation.value === null) {
        throw new ScimPatchError('A pathless PATCH operation requires an object value');
      }
      Object.assign(result, operation.value as Record<string, unknown>);
      continue;
    }

    if (/[[\]]/.test(operation.path)) {
      throw new ScimPatchError(
        `Value-filter paths are not supported: "${operation.path}"`,
      );
    }

    setPath(result, operation.path, op === 'remove' ? undefined : operation.value);
  }

  return result;
}

/** Set a dotted path, treating a leading schema URN as a single segment. */
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = splitScimPath(path);
  let cursor = target;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i] as string;
    const next = cursor[key];
    if (typeof next !== 'object' || next === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }

  const last = segments[segments.length - 1] as string;
  if (value === undefined) delete cursor[last];
  else cursor[last] = value;
}

function splitScimPath(path: string): string[] {
  for (const urn of [NERM_USER_SCHEMA, ENTERPRISE_USER_SCHEMA, CORE_USER_SCHEMA]) {
    if (path.toLowerCase().startsWith(`${urn.toLowerCase()}:`)) {
      return [urn, ...path.slice(urn.length + 1).split('.')];
    }
  }
  return path.split('.');
}
