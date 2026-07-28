import { prisma } from '@/lib/db';
import { toScimGroup } from '@/lib/scim/mapper';
import {
  authorizeScim,
  baseUrlFrom,
  scimErrorResponse,
  scimJson,
  toScimErrorResponse,
} from '@/lib/scim/handler';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeScim(request, 'scim:read');
  if ('response' in authorized) return authorized.response;

  try {
    const { id } = await params;
    const vendor = await prisma.vendorCompany.findFirst({
      where: { id, organizationId: authorized.actor.organizationId },
      include: {
        people: {
          where: { archivedAt: null, lifecycleState: { in: ['ACTIVE', 'EXPIRING'] } },
          select: { id: true, email: true },
        },
      },
    });

    if (!vendor) return scimErrorResponse(404, `Group ${id} not found`);

    return scimJson(toScimGroup(vendor, baseUrlFrom(request)));
  } catch (error) {
    return toScimErrorResponse(error);
  }
}
