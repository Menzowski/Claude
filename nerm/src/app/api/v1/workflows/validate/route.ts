import { NextResponse } from 'next/server';
import { validateDefinition } from '@/lib/workflow/definitions';
import { authorize, toErrorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/workflows/validate — check a definition without storing it.
 *
 * Errors carry a JSON path so a CI job or the admin editor can point at the
 * offending line rather than saying "invalid".
 */
export async function POST(request: Request) {
  const authorized = await authorize(request, { scope: 'api:workflows' });
  if ('response' in authorized) return authorized.response;

  try {
    const result = validateDefinition(await request.json());

    return result.valid
      ? NextResponse.json({ valid: true, warnings: result.warnings })
      : NextResponse.json({ valid: false, errors: result.errors }, { status: 422 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
