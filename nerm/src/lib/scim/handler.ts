import { NextResponse } from 'next/server';
import { authenticateApiToken, hasScope, type ApiActor } from '@/lib/auth/api-token';
import { ScimFilterError } from './filter';
import { ScimPatchError, scimError } from './mapper';

/** SCIM responses use their own media type. */
export const SCIM_CONTENT_TYPE = 'application/scim+json; charset=utf-8';

export function scimJson(body: unknown, init: ResponseInit = {}): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': SCIM_CONTENT_TYPE, ...(init.headers ?? {}) },
  });
}

export function scimErrorResponse(
  status: number,
  detail: string,
  scimType?: string,
): NextResponse {
  return scimJson(scimError(status, detail, scimType), { status });
}

/**
 * Authenticate a SCIM request and require a scope.
 * Returns either the actor or the response to send back.
 */
export async function authorizeScim(
  request: Request,
  scope: 'scim:read' | 'scim:write',
): Promise<{ actor: ApiActor } | { response: NextResponse }> {
  const actor = await authenticateApiToken(request.headers.get('authorization'));

  if (!actor) {
    return {
      response: scimJson(scimError(401, 'Invalid or missing bearer token'), {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="scim"' },
      }),
    };
  }

  if (!hasScope(actor, scope)) {
    return { response: scimErrorResponse(403, `Token lacks the "${scope}" scope`) };
  }

  return { actor };
}

/** Map known error types onto SCIM error responses; anything else is a 500. */
export function toScimErrorResponse(error: unknown): NextResponse {
  if (error instanceof ScimFilterError) {
    return scimErrorResponse(400, error.message, error.scimType);
  }
  if (error instanceof ScimPatchError) {
    return scimErrorResponse(400, error.message, error.scimType);
  }
  if (error instanceof SyntaxError) {
    return scimErrorResponse(400, 'Request body is not valid JSON', 'invalidSyntax');
  }
  console.error('SCIM request failed', error);
  return scimErrorResponse(500, 'Internal server error');
}

/** Base URL for `meta.location` and `$ref` values. */
export function baseUrlFrom(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const protocol = forwardedProto ?? url.protocol.replace(':', '');
  const host = forwardedHost ?? url.host;
  return `${protocol}://${host}`;
}

export type Pagination = { startIndex: number; count: number };

/**
 * SCIM pagination is 1-based on `startIndex`, with `count` capped so a client
 * cannot request the entire population in one response.
 */
export function parsePagination(url: URL, maxCount = 200): Pagination {
  const rawStart = Number(url.searchParams.get('startIndex') ?? '1');
  const rawCount = Number(url.searchParams.get('count') ?? '100');

  const startIndex = Number.isFinite(rawStart) && rawStart >= 1 ? Math.floor(rawStart) : 1;
  const count =
    Number.isFinite(rawCount) && rawCount >= 0 ? Math.min(Math.floor(rawCount), maxCount) : 100;

  return { startIndex, count };
}
