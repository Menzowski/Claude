import { describe, expect, it } from 'vitest';
import { ScimFilterError, parseGroupFilter, parseSortBy, parseUserFilter } from './filter';

describe('parseUserFilter', () => {
  it('returns an empty filter for empty input', () => {
    expect(parseUserFilter('')).toEqual({});
    expect(parseUserFilter('   ')).toEqual({});
  });

  it('maps userName eq to a case-insensitive email match', () => {
    expect(parseUserFilter('userName eq "Jo@Example.com"')).toEqual({
      email: { equals: 'Jo@Example.com', mode: 'insensitive' },
    });
  });

  it('maps externalId eq to an exact match', () => {
    expect(parseUserFilter('externalId eq "abc123"')).toEqual({ externalId: 'abc123' });
  });

  it('supports co, sw and ew', () => {
    expect(parseUserFilter('name.familyName co "smi"')).toEqual({
      lastName: { contains: 'smi', mode: 'insensitive' },
    });
    expect(parseUserFilter('userName sw "jo"')).toEqual({
      email: { startsWith: 'jo', mode: 'insensitive' },
    });
    expect(parseUserFilter('userName ew "@example.com"')).toEqual({
      email: { endsWith: '@example.com', mode: 'insensitive' },
    });
  });

  it('derives active from lifecycle state rather than a stored column', () => {
    expect(parseUserFilter('active eq true')).toEqual({
      lifecycleState: { in: ['ACTIVE', 'EXPIRING'] },
    });
    expect(parseUserFilter('active eq false')).toEqual({
      lifecycleState: { notIn: ['ACTIVE', 'EXPIRING'] },
    });
    // ne inverts the same way
    expect(parseUserFilter('active ne true')).toEqual({
      lifecycleState: { notIn: ['ACTIVE', 'EXPIRING'] },
    });
  });

  it('handles the incremental-aggregation date filter ISC sends', () => {
    const where = parseUserFilter('meta.lastModified gt "2026-01-01T00:00:00Z"');
    expect(where).toEqual({ updatedAt: { gt: new Date('2026-01-01T00:00:00Z') } });
  });

  it('supports and / or with correct precedence', () => {
    expect(parseUserFilter('active eq true and department eq "Engineering"')).toEqual({
      AND: [
        { lifecycleState: { in: ['ACTIVE', 'EXPIRING'] } },
        { department: { equals: 'Engineering', mode: 'insensitive' } },
      ],
    });

    // and binds tighter than or
    const where = parseUserFilter('userName eq "a" or userName eq "b" and title eq "c"');
    expect(where).toEqual({
      OR: [
        { email: { equals: 'a', mode: 'insensitive' } },
        {
          AND: [
            { email: { equals: 'b', mode: 'insensitive' } },
            { jobTitle: { equals: 'c', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });

  it('supports grouping and not', () => {
    expect(parseUserFilter('(userName eq "a" or userName eq "b")')).toEqual({
      OR: [
        { email: { equals: 'a', mode: 'insensitive' } },
        { email: { equals: 'b', mode: 'insensitive' } },
      ],
    });
    expect(parseUserFilter('not (active eq true)')).toEqual({
      NOT: { lifecycleState: { in: ['ACTIVE', 'EXPIRING'] } },
    });
  });

  it('supports presence', () => {
    expect(parseUserFilter('endDate pr')).toEqual({ endDate: { not: null } });
  });

  it('accepts urn-prefixed attribute paths', () => {
    expect(parseUserFilter('urn:nerm:2.0:NonEmployee:riskTier eq "HIGH"')).toEqual({
      riskTier: 'HIGH',
    });
    expect(
      parseUserFilter('urn:ietf:params:scim:schemas:core:2.0:User:userName eq "a"'),
    ).toEqual({ email: { equals: 'a', mode: 'insensitive' } });
  });

  it('normalises enum case but rejects invalid enum values', () => {
    expect(parseUserFilter('lifecycleState eq "active"')).toEqual({ lifecycleState: 'ACTIVE' });
    expect(() => parseUserFilter('lifecycleState eq "GONE_FISHING"')).toThrow(ScimFilterError);
  });

  // The important ones: a filter we cannot honour must fail loudly, because
  // silently ignoring a clause returns the whole population.
  it('rejects an unknown attribute rather than matching everything', () => {
    expect(() => parseUserFilter('nickname eq "jo"')).toThrow(ScimFilterError);
  });

  it('rejects an unsupported operator', () => {
    expect(() => parseUserFilter('userName like "jo"')).toThrow(ScimFilterError);
  });

  it('rejects malformed filters', () => {
    expect(() => parseUserFilter('userName eq')).toThrow(ScimFilterError);
    expect(() => parseUserFilter('userName')).toThrow(ScimFilterError);
    expect(() => parseUserFilter('(userName eq "a"')).toThrow(ScimFilterError);
    expect(() => parseUserFilter('userName eq "unterminated')).toThrow(ScimFilterError);
    expect(() => parseUserFilter('userName eq "a" trailing')).toThrow(ScimFilterError);
    expect(() => parseUserFilter('not userName eq "a"')).toThrow(ScimFilterError);
  });

  it('rejects type mismatches', () => {
    expect(() => parseUserFilter('active eq "yes"')).toThrow(ScimFilterError);
    expect(() => parseUserFilter('meta.lastModified gt "not-a-date"')).toThrow(ScimFilterError);
    expect(() => parseUserFilter('userName gt "a"')).toThrow(ScimFilterError);
  });
});

describe('parseGroupFilter', () => {
  it('maps displayName to the vendor company name', () => {
    expect(parseGroupFilter('displayName eq "Acme Consulting"')).toEqual({
      name: { equals: 'Acme Consulting', mode: 'insensitive' },
    });
  });

  it('rejects user attributes on the group endpoint', () => {
    expect(() => parseGroupFilter('userName eq "a"')).toThrow(ScimFilterError);
  });
});

describe('parseSortBy', () => {
  it('maps known attributes and rejects the rest', () => {
    expect(parseSortBy('userName')).toBe('email');
    expect(parseSortBy('meta.lastModified')).toBe('updatedAt');
    expect(parseSortBy('active')).toBeNull();
    expect(parseSortBy('unknown')).toBeNull();
    expect(parseSortBy(null)).toBeNull();
  });
});
