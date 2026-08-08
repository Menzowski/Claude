import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { createPerson } from '@/lib/domain/person';
import { ValidationError } from '@/lib/domain/person';
import { parseSortBy, parseUserFilter } from '@/lib/scim/filter';
import { fromScimUser, listResponse, personEtag, toScimUser } from '@/lib/scim/mapper';
import {
  authorizeScim,
  baseUrlFrom,
  parsePagination,
  scimErrorResponse,
  scimJson,
  toScimErrorResponse,
} from '@/lib/scim/handler';

export const dynamic = 'force-dynamic';

const INCLUDE = {
  vendorCompany: { select: { id: true, name: true } },
  sponsor: { select: { id: true, name: true, email: true } },
} satisfies Prisma.PersonInclude;

/**
 * GET /scim/v2/Users — the endpoint Identity Security Cloud aggregates against.
 *
 * Ordering is stable (the requested sort, then id) so that paging through a
 * large population cannot skip or repeat records when rows are being written
 * concurrently.
 */
export async function GET(request: Request) {
  const authorized = await authorizeScim(request, 'scim:read');
  if ('response' in authorized) return authorized.response;

  try {
    const url = new URL(request.url);
    const { startIndex, count } = parsePagination(url);
    const filter = url.searchParams.get('filter');

    const where: Prisma.PersonWhereInput = {
      organizationId: authorized.actor.organizationId,
      archivedAt: null,
      ...(filter ? parseUserFilter(filter) : {}),
    };

    const sortField = parseSortBy(url.searchParams.get('sortBy'));
    const descending = url.searchParams.get('sortOrder')?.toLowerCase() === 'descending';
    const orderBy: Prisma.PersonOrderByWithRelationInput[] = sortField
      ? [{ [sortField]: descending ? 'desc' : 'asc' }, { id: 'asc' }]
      : [{ id: 'asc' }];

    const [totalResults, people] = await Promise.all([
      prisma.person.count({ where }),
      count === 0
        ? Promise.resolve([])
        : prisma.person.findMany({
            where,
            include: INCLUDE,
            orderBy,
            skip: startIndex - 1,
            take: count,
          }),
    ]);

    const baseUrl = baseUrlFrom(request);
    return scimJson(
      listResponse(
        people.map((person) => toScimUser(person, baseUrl)),
        totalResults,
        startIndex,
        people.length,
      ),
    );
  } catch (error) {
    return toScimErrorResponse(error);
  }
}

/** POST /scim/v2/Users — inbound provisioning of a non-employee. */
export async function POST(request: Request) {
  const authorized = await authorizeScim(request, 'scim:write');
  if ('response' in authorized) return authorized.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input = fromScimUser(body);

    if (!input.email) {
      return scimErrorResponse(400, 'userName is required', 'invalidValue');
    }
    if (!input.firstName || !input.lastName) {
      return scimErrorResponse(
        400,
        'name.givenName and name.familyName are required',
        'invalidValue',
      );
    }

    const organizationId = authorized.actor.organizationId;

    // A SCIM client does not know about profile types, so inbound users land on
    // the organization's default type. Which type that is remains configuration.
    const profileType = await prisma.profileType.findFirst({
      where: { organizationId, active: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!profileType) {
      return scimErrorResponse(500, 'No profile type is configured for this organization');
    }

    const person = await createPerson(
      {
        organizationId,
        profileTypeId: profileType.id,
        type: 'CONTRACTOR',
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        jobTitle: input.jobTitle ?? null,
        department: input.department ?? null,
        location: input.location ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        ...(input.externalId ? { externalId: input.externalId } : {}),
        attributes: input.attributes,
      },
      {
        kind: 'API_CLIENT',
        id: authorized.actor.client.id,
        label: authorized.actor.client.name,
      },
      // See CreatePersonOptions: a SCIM client cannot know this organization's
      // required custom attributes, so the record lands in DRAFT for a sponsor
      // to complete rather than being rejected at the boundary.
      { allowIncompleteAttributes: true },
    );

    await writeAudit({
      organizationId,
      action: 'scim.user.created',
      actor: {
        kind: 'API_CLIENT',
        id: authorized.actor.client.id,
        label: authorized.actor.client.name,
      },
      subjectType: 'Person',
      subjectId: person.id,
    });

    const full = await prisma.person.findUniqueOrThrow({
      where: { id: person.id },
      include: INCLUDE,
    });

    const baseUrl = baseUrlFrom(request);
    return scimJson(toScimUser(full, baseUrl), {
      status: 201,
      headers: {
        Location: `${baseUrl}/scim/v2/Users/${person.id}`,
        ETag: personEtag(full),
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      const detail = error.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
      // A duplicate userName is 409 per RFC 7644 §3.3.
      const isDuplicate = error.issues.some((i) => i.path === 'email');
      return scimErrorResponse(
        isDuplicate ? 409 : 400,
        detail || error.message,
        isDuplicate ? 'uniqueness' : 'invalidValue',
      );
    }
    return toScimErrorResponse(error);
  }
}
