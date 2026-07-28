import { NextResponse } from 'next/server';
import { getVersion } from '@/lib/workflow/definitions';
import { authorize, jsonError, toErrorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/workflows/{key}/versions/{version} — the exact definition JSON.
 *
 * This is the export half of the round trip: the body returned here is
 * byte-for-byte what PUT accepts, so a definition can be committed to git,
 * diffed, and promoted to another environment unchanged.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string; version: string }> },
) {
  const authorized = await authorize(request, { scope: 'api:workflows' });
  if ('response' in authorized) return authorized.response;

  try {
    const { key, version } = await params;
    const parsed = Number(version);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return jsonError(400, `"${version}" is not a valid version number`);
    }

    const record = await getVersion(authorized.actor.organizationId, key, parsed);
    if (!record) return jsonError(404, `No version ${parsed} of "${key}"`);

    return NextResponse.json(record.definition, {
      headers: { 'X-Workflow-Active': String(record.active) },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
