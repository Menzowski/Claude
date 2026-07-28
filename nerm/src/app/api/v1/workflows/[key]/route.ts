import { NextResponse } from 'next/server';
import { getVersions, publishDefinition } from '@/lib/workflow/definitions';
import { auditActorFor, authorize, jsonError, toErrorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ key: string }> };

/** GET /api/v1/workflows/{key} — every published version, newest first. */
export async function GET(request: Request, { params }: Params) {
  const authorized = await authorize(request, { scope: 'api:workflows' });
  if ('response' in authorized) return authorized.response;

  try {
    const { key } = await params;
    const versions = await getVersions(authorized.actor.organizationId, key);
    if (versions.length === 0) return jsonError(404, `No workflow with key "${key}"`);

    return NextResponse.json({
      key,
      versions: versions.map((v) => ({
        version: v.version,
        name: v.name,
        active: v.active,
        createdAt: v.createdAt,
        definition: v.definition,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * PUT /api/v1/workflows/{key} — publish a new version from a JSON body.
 *
 * Published versions are immutable, so this never overwrites: it appends. The
 * new version is inactive until explicitly activated, which is what makes
 * export → edit → import safe to run against production.
 */
export async function PUT(request: Request, { params }: Params) {
  const authorized = await authorize(request, {
    scope: 'api:workflows',
    requireAdmin: true,
  });
  if ('response' in authorized) return authorized.response;

  try {
    const { key } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    if (typeof body.key === 'string' && body.key !== key) {
      return jsonError(
        400,
        `Body key "${body.key}" does not match the URL key "${key}"`,
      );
    }

    const result = await publishDefinition({
      organizationId: authorized.actor.organizationId,
      input: { ...body, key },
      actor: auditActorFor(authorized.actor),
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
