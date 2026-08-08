import { NextResponse } from 'next/server';
import { authenticateApiToken, hasScope, type ApiActor } from '@/lib/auth/api-token';
import { currentActor } from '@/lib/auth/actor';
import { DefinitionError } from '@/lib/workflow/definitions';
import { ValidationError } from '@/lib/domain/person';
import { ForbiddenError, isAdmin, type Actor } from '@/lib/authz/scope';

/**
 * Shared plumbing for `/api/v1`.
 *
 * The REST API accepts either a bearer token (Postman, CI, integrations) or a
 * signed-in session (the admin UI calls the same endpoints the API documents —
 * that is what keeps the two authoring paths honest about being one surface).
 */

export type RequestActor =
  | { kind: 'api'; api: ApiActor; organizationId: string }
  | { kind: 'user'; user: Actor; organizationId: string };

export function jsonError(status: number, message: string, details?: unknown): NextResponse {
  return NextResponse.json(
    { error: { status, message, ...(details ? { details } : {}) } },
    { status },
  );
}

/**
 * Authenticate a request. `scope` is required for token callers; session
 * callers are checked against `requireAdmin` instead.
 */
export async function authorize(
  request: Request,
  options: { scope: string; requireAdmin?: boolean },
): Promise<{ actor: RequestActor } | { response: NextResponse }> {
  const header = request.headers.get('authorization');

  if (header) {
    const api = await authenticateApiToken(header);
    if (!api) return { response: jsonError(401, 'Invalid or expired token') };
    if (!hasScope(api, options.scope)) {
      return { response: jsonError(403, `Token lacks the "${options.scope}" scope`) };
    }
    return {
      actor: { kind: 'api', api, organizationId: api.organizationId },
    };
  }

  const user = await currentActor();
  if (!user) return { response: jsonError(401, 'Authentication required') };

  if (options.requireAdmin && !isAdmin(user)) {
    return { response: jsonError(403, 'Administrator role required') };
  }

  return { actor: { kind: 'user', user, organizationId: user.organizationId } };
}

/** The audit actor for whichever caller authenticated. */
export function auditActorFor(actor: RequestActor) {
  return actor.kind === 'api'
    ? { kind: 'API_CLIENT' as const, id: actor.api.client.id, label: actor.api.client.name }
    : { kind: 'USER' as const, id: actor.user.userId, label: actor.user.email };
}

/** Map domain errors onto responses; anything unrecognised is a 500. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof DefinitionError) {
    return jsonError(400, error.message, error.issues);
  }
  if (error instanceof ValidationError) {
    return jsonError(400, error.message, error.issues);
  }
  if (error instanceof ForbiddenError) {
    return jsonError(403, error.message);
  }
  if (error instanceof SyntaxError) {
    return jsonError(400, 'Request body is not valid JSON');
  }
  console.error('API request failed', error);
  return jsonError(500, 'Internal server error');
}
