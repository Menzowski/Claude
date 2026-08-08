import { NextResponse } from 'next/server';
import { activateVersion } from '@/lib/workflow/definitions';
import { auditActorFor, authorize, jsonError, toErrorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/workflows/{key}/activate — choose the version new instances start on.
 *
 * Separated from publishing on purpose: promoting a workflow to production is a
 * decision, and it should be one an operator makes deliberately (and one the
 * audit log records as its own event).
 */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const authorized = await authorize(request, {
    scope: 'api:workflows',
    requireAdmin: true,
  });
  if ('response' in authorized) return authorized.response;

  try {
    const { key } = await params;
    const body = (await request.json().catch(() => ({}))) as { version?: unknown };
    const version = Number(body.version);

    if (!Number.isInteger(version) || version < 1) {
      return jsonError(400, 'A positive integer "version" is required');
    }

    await activateVersion({
      organizationId: authorized.actor.organizationId,
      key,
      version,
      actor: auditActorFor(authorized.actor),
    });

    return NextResponse.json({ key, version, active: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
