import type { Prisma } from '@prisma/client';

/**
 * RFC 7644 §3.4.2.2 filter parser, compiled to a Prisma `where` fragment.
 *
 * This file gets more care than its size suggests. Aggregation from Identity
 * Security Cloud sends filters like
 *
 *   userName eq "jo@example.com"
 *   meta.lastModified gt "2026-01-01T00:00:00Z"
 *   active eq true and urn:nerm:2.0:NonEmployee:riskTier eq "HIGH"
 *
 * A parser that silently ignores a clause it does not understand will happily
 * return the whole population, and the failure surfaces as a mysteriously
 * over-broad aggregation weeks later. So unknown attributes and malformed
 * filters raise `ScimFilterError` (400) rather than degrading to "match all".
 *
 * Grammar (the subset ISC and common SCIM clients emit):
 *   filter     := or
 *   or         := and ("or" and)*
 *   and        := term ("and" term)*
 *   term       := "not" "(" filter ")" | "(" filter ")" | comparison | presence
 *   comparison := attrPath OP value
 *   presence   := attrPath "pr"
 */

export class ScimFilterError extends Error {
  readonly status = 400;
  readonly scimType = 'invalidFilter';
  constructor(message: string) {
    super(message);
    this.name = 'ScimFilterError';
  }
}

/** Attribute kinds we know how to compare. */
type FieldType = 'string' | 'boolean' | 'datetime' | 'enum';

type FieldMapping = {
  /** Prisma field path; nested paths use dots. */
  field: string;
  type: FieldType;
  /** Whether string comparison should be case-insensitive (SCIM default). */
  caseInsensitive?: boolean;
  /** Allowed values for enum fields, for validation and mapping. */
  values?: readonly string[];
};

const NERM_URN = 'urn:nerm:2.0:NonEmployee';
const ENTERPRISE_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

/**
 * SCIM attribute name → storage. Keys are lowercased; the URN prefixes are
 * stripped before lookup so `urn:...:User:userName` and `userName` both work,
 * as RFC 7644 §3.10 permits.
 */
const USER_FIELDS: Record<string, FieldMapping> = {
  id: { field: 'id', type: 'string' },
  externalid: { field: 'externalId', type: 'string' },
  username: { field: 'email', type: 'string', caseInsensitive: true },
  'emails.value': { field: 'email', type: 'string', caseInsensitive: true },
  emails: { field: 'email', type: 'string', caseInsensitive: true },
  'name.givenname': { field: 'firstName', type: 'string', caseInsensitive: true },
  'name.familyname': { field: 'lastName', type: 'string', caseInsensitive: true },
  displayname: { field: 'firstName', type: 'string', caseInsensitive: true },
  title: { field: 'jobTitle', type: 'string', caseInsensitive: true },
  active: { field: 'active', type: 'boolean' },
  'meta.lastmodified': { field: 'updatedAt', type: 'datetime' },
  'meta.created': { field: 'createdAt', type: 'datetime' },
  // Enterprise extension
  department: { field: 'department', type: 'string', caseInsensitive: true },
  'manager.value': { field: 'sponsorUserId', type: 'string' },
  // NERM extension
  lifecyclestate: {
    field: 'lifecycleState',
    type: 'enum',
    values: [
      'DRAFT',
      'PENDING_APPROVAL',
      'APPROVED',
      'ACTIVE',
      'EXPIRING',
      'SUSPENDED',
      'INACTIVE',
      'REJECTED',
      'ARCHIVED',
    ],
  },
  risktier: { field: 'riskTier', type: 'enum', values: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
  persontype: {
    field: 'type',
    type: 'enum',
    values: ['CONTRACTOR', 'VENDOR', 'VOLUNTEER', 'INTERN', 'SERVICE'],
  },
  vendorcompanyid: { field: 'vendorCompanyId', type: 'string' },
  'vendorcompany.value': { field: 'vendorCompanyId', type: 'string' },
  startdate: { field: 'startDate', type: 'datetime' },
  enddate: { field: 'endDate', type: 'datetime' },
};

const GROUP_FIELDS: Record<string, FieldMapping> = {
  id: { field: 'id', type: 'string' },
  externalid: { field: 'externalId', type: 'string' },
  displayname: { field: 'name', type: 'string', caseInsensitive: true },
};

/** States that make a person `active: true` in SCIM. */
const ACTIVE_STATES = ['ACTIVE', 'EXPIRING'] as const;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { type: 'word'; value: string }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i] as string;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }

    if (ch === '"') {
      let value = '';
      i += 1;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          const next = input[i + 1] as string;
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
        } else {
          value += input[i];
          i += 1;
        }
      }
      if (i >= input.length) throw new ScimFilterError('Unterminated string in filter');
      i += 1;
      tokens.push({ type: 'string', value });
      continue;
    }

    // Bare word: attribute path, operator, or literal.
    let word = '';
    while (i < input.length && !/[\s()]/.test(input[i] as string)) {
      word += input[i];
      i += 1;
    }

    if (word === 'true' || word === 'false') {
      tokens.push({ type: 'boolean', value: word === 'true' });
    } else if (word === 'null') {
      tokens.push({ type: 'null' });
    } else if (/^-?\d+(\.\d+)?$/.test(word)) {
      tokens.push({ type: 'number', value: Number(word) });
    } else {
      tokens.push({ type: 'word', value: word });
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const COMPARISON_OPS = ['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'ge', 'lt', 'le'] as const;
type ComparisonOp = (typeof COMPARISON_OPS)[number];

type WhereInput = Record<string, unknown>;

class FilterParser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly fields: Record<string, FieldMapping>,
  ) {}

  parse(): WhereInput {
    const result = this.parseOr();
    if (this.index < this.tokens.length) {
      throw new ScimFilterError('Unexpected trailing input in filter');
    }
    return result;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private consumeKeyword(keyword: string): boolean {
    const token = this.peek();
    if (token?.type === 'word' && token.value.toLowerCase() === keyword) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private parseOr(): WhereInput {
    const terms = [this.parseAnd()];
    while (this.consumeKeyword('or')) terms.push(this.parseAnd());
    return terms.length === 1 ? (terms[0] as WhereInput) : { OR: terms };
  }

  private parseAnd(): WhereInput {
    const terms = [this.parseTerm()];
    while (this.consumeKeyword('and')) terms.push(this.parseTerm());
    return terms.length === 1 ? (terms[0] as WhereInput) : { AND: terms };
  }

  private parseTerm(): WhereInput {
    if (this.consumeKeyword('not')) {
      const token = this.peek();
      if (token?.type !== 'lparen') {
        throw new ScimFilterError('"not" must be followed by a parenthesised filter');
      }
      this.index += 1;
      const inner = this.parseOr();
      if (this.peek()?.type !== 'rparen') throw new ScimFilterError('Expected ")"');
      this.index += 1;
      return { NOT: inner };
    }

    if (this.peek()?.type === 'lparen') {
      this.index += 1;
      const inner = this.parseOr();
      if (this.peek()?.type !== 'rparen') throw new ScimFilterError('Expected ")"');
      this.index += 1;
      return inner;
    }

    return this.parseComparison();
  }

  private parseComparison(): WhereInput {
    const attrToken = this.peek();
    if (attrToken?.type !== 'word') {
      throw new ScimFilterError('Expected an attribute name in filter');
    }
    this.index += 1;

    const mapping = this.lookup(attrToken.value);

    const opToken = this.peek();
    if (opToken?.type !== 'word') {
      throw new ScimFilterError(`Expected an operator after "${attrToken.value}"`);
    }
    const op = opToken.value.toLowerCase();
    this.index += 1;

    // Presence: `attr pr` takes no value.
    if (op === 'pr') return this.presence(mapping);

    if (!COMPARISON_OPS.includes(op as ComparisonOp)) {
      throw new ScimFilterError(`Unsupported filter operator "${op}"`);
    }

    const valueToken = this.peek();
    if (!valueToken || valueToken.type === 'lparen' || valueToken.type === 'rparen') {
      throw new ScimFilterError(`Expected a value after "${op}"`);
    }
    this.index += 1;

    const value =
      valueToken.type === 'string'
        ? valueToken.value
        : valueToken.type === 'number'
          ? valueToken.value
          : valueToken.type === 'boolean'
            ? valueToken.value
            : null;

    return this.comparison(mapping, op as ComparisonOp, value);
  }

  private lookup(rawPath: string): FieldMapping {
    // Strip a schema URN prefix if present: `urn:...:User:userName` → `userName`.
    let path = rawPath;
    for (const urn of [NERM_URN, ENTERPRISE_URN, 'urn:ietf:params:scim:schemas:core:2.0:User']) {
      if (path.toLowerCase().startsWith(`${urn.toLowerCase()}:`)) {
        path = path.slice(urn.length + 1);
        break;
      }
    }

    const mapping = this.fields[path.toLowerCase()];
    if (!mapping) {
      throw new ScimFilterError(`Unknown or unfilterable attribute "${rawPath}"`);
    }
    return mapping;
  }

  private presence(mapping: FieldMapping): WhereInput {
    if (mapping.field === 'active') {
      return { lifecycleState: { in: ACTIVE_STATES } };
    }
    return { [mapping.field]: { not: null } };
  }

  private comparison(
    mapping: FieldMapping,
    op: ComparisonOp,
    value: string | number | boolean | null,
  ): WhereInput {
    // `active` is derived from lifecycle state, not stored.
    if (mapping.field === 'active') {
      if (typeof value !== 'boolean' || (op !== 'eq' && op !== 'ne')) {
        throw new ScimFilterError('"active" supports only eq/ne with a boolean value');
      }
      const wantActive = op === 'eq' ? value : !value;
      return wantActive
        ? { lifecycleState: { in: ACTIVE_STATES } }
        : { lifecycleState: { notIn: ACTIVE_STATES } };
    }

    if (mapping.type === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new ScimFilterError(`Attribute expects a boolean value`);
      }
      return { [mapping.field]: op === 'ne' ? { not: value } : value };
    }

    if (mapping.type === 'datetime') {
      if (typeof value !== 'string') {
        throw new ScimFilterError('Date comparison requires a quoted ISO 8601 value');
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        throw new ScimFilterError(`Invalid date value "${value}"`);
      }
      switch (op) {
        case 'eq':
          return { [mapping.field]: date };
        case 'ne':
          return { [mapping.field]: { not: date } };
        case 'gt':
          return { [mapping.field]: { gt: date } };
        case 'ge':
          return { [mapping.field]: { gte: date } };
        case 'lt':
          return { [mapping.field]: { lt: date } };
        case 'le':
          return { [mapping.field]: { lte: date } };
        default:
          throw new ScimFilterError(`Operator "${op}" is not valid for a date attribute`);
      }
    }

    if (mapping.type === 'enum') {
      if (typeof value !== 'string') {
        throw new ScimFilterError('Enum comparison requires a quoted string value');
      }
      const upper = value.toUpperCase();
      if (mapping.values && !mapping.values.includes(upper)) {
        throw new ScimFilterError(
          `"${value}" is not a valid value; expected one of ${mapping.values.join(', ')}`,
        );
      }
      if (op === 'eq') return { [mapping.field]: upper };
      if (op === 'ne') return { [mapping.field]: { not: upper } };
      throw new ScimFilterError(`Operator "${op}" is not valid for an enumerated attribute`);
    }

    // String
    if (typeof value !== 'string') {
      throw new ScimFilterError('String comparison requires a quoted value');
    }
    const mode: Prisma.QueryMode | undefined = mapping.caseInsensitive
      ? 'insensitive'
      : undefined;

    switch (op) {
      case 'eq':
        return { [mapping.field]: mode ? { equals: value, mode } : value };
      case 'ne':
        return { [mapping.field]: { not: mode ? { equals: value, mode } : value } };
      case 'co':
        return { [mapping.field]: { contains: value, ...(mode ? { mode } : {}) } };
      case 'sw':
        return { [mapping.field]: { startsWith: value, ...(mode ? { mode } : {}) } };
      case 'ew':
        return { [mapping.field]: { endsWith: value, ...(mode ? { mode } : {}) } };
      default:
        throw new ScimFilterError(`Operator "${op}" is not valid for a string attribute`);
    }
  }
}

/** Compile a SCIM `filter` for /Users into a Prisma `PersonWhereInput`. */
export function parseUserFilter(filter: string): Prisma.PersonWhereInput {
  if (!filter.trim()) return {};
  return new FilterParser(tokenize(filter), USER_FIELDS).parse() as Prisma.PersonWhereInput;
}

/** Compile a SCIM `filter` for /Groups into a Prisma `VendorCompanyWhereInput`. */
export function parseGroupFilter(filter: string): Prisma.VendorCompanyWhereInput {
  if (!filter.trim()) return {};
  return new FilterParser(
    tokenize(filter),
    GROUP_FIELDS,
  ).parse() as Prisma.VendorCompanyWhereInput;
}

/** Map a SCIM `sortBy` attribute to a Prisma orderBy field, or null if unsortable. */
export function parseSortBy(sortBy: string | null): string | null {
  if (!sortBy) return null;
  const mapping = USER_FIELDS[sortBy.toLowerCase()];
  if (!mapping || mapping.field === 'active') return null;
  return mapping.field;
}
