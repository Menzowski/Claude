import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { parseGroupFilter } from '@/lib/scim/filter';
import { listResponse, toScimGroup } from '@/lib/scim/mapper';
import {
  authorizeScim,
  baseUrlFrom,
  parsePagination,
  scimJson,
  toScimErrorResponse,
} from '@/lib/scim/handler';

export const dynamic = 'force-dynamic';

/**
 * GET /scim/v2/Groups — vendor companies, with their active workers as members.
 * This is what gives ISC the vendor dimension for access policy without a
 * second integration.
 */
export async function GET(request: Request) {
  const authorized = await authorizeScim(request, 'scim:read');
  if ('response' in authorized) return authorized.response;

  try {
    const url = new URL(request.url);
    const { startIndex, count } = parsePagination(url);
    const filter = url.searchParams.get('filter');

    const where: Prisma.VendorCompanyWhereInput = {
      organizationId: authorized.actor.organizationId,
      ...(filter ? parseGroupFilter(filter) : {}),
    };

    const [totalResults, vendors] = await Promise.all([
      prisma.vendorCompany.count({ where }),
      count === 0
        ? Promise.resolve([])
        : prisma.vendorCompany.findMany({
            where,
            include: {
              people: {
                where: { archivedAt: null, lifecycleState: { in: ['ACTIVE', 'EXPIRING'] } },
                select: { id: true, email: true },
              },
            },
            orderBy: { id: 'asc' },
            skip: startIndex - 1,
            take: count,
          }),
    ]);

    const baseUrl = baseUrlFrom(request);
    return scimJson(
      listResponse(
        vendors.map((vendor) => toScimGroup(vendor, baseUrl)),
        totalResults,
        startIndex,
        vendors.length,
      ),
    );
  } catch (error) {
    return toScimErrorResponse(error);
  }
}
