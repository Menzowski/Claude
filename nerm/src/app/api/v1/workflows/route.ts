import { NextResponse } from 'next/server';
import { listDefinitions, publishDefinition } from '@/lib/workflow/definitions';
import { auditActorFor, authorize, toErrorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** GET /api/v1/workflows — latest version of every definition. */
export async function GET(request: Request) {
  const authorized = await authorize(request, { scope: 'api:workflows' });
  if ('response' in authorized) return authorized.response;

  try {
    const definitions = await listDefinitions(authorized.actor.organizationId);
    return NextResponse.json({ definitions });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/workflows — publish version 1 of a new definition.
 *
 * Publishing an existing key through POST is rejected: creating and versioning
 * are different intents, and conflating them makes it too easy to bump a
 * production workflow while believing you created a new one.
 */
export async function POST(request: Request) {
  const authorized = await authorize(request, {
    scope: 'api:workflows',
    requireAdmin: true,
  });
  if ('response' in authorized) return authorized.response;

  try {
    const body = await request.json();
    const existing = await listDefinitions(authorized.actor.organizationId);
    const key = (body as { key?: unknown }).key;

    if (typeof key === 'string' && existing.some((d) => d.key === key)) {
      return NextResponse.json(
        {
          error: {
            status: 409,
            message: `Workflow "${key}" already exists. Use PUT /api/v1/workflows/${key} to publish a new version.`,
          },
        },
        { status: 409 },
      );
    }

    const result = await publishDefinition({
      organizationId: authorized.actor.organizationId,
      input: body,
      actor: auditActorFor(authorized.actor),
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
