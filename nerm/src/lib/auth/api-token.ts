import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiClient } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Bearer-token authentication for the machine surfaces (`/api/v1`, `/scim/v2`).
 *
 * Tokens are stored as SHA-256 digests — a database disclosure yields no usable
 * credential. The plaintext is returned exactly once, at creation.
 */

const PREFIX = 'nerm_';

export type IssuedToken = { token: string; tokenHash: string; tokenPrefix: string };

export function generateToken(): IssuedToken {
  const secret = randomBytes(32).toString('base64url');
  const token = `${PREFIX}${secret}`;
  return {
    token,
    tokenHash: hashToken(token),
    tokenPrefix: token.slice(0, PREFIX.length + 6),
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of two hex digests. */
function digestsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type ApiActor = {
  client: ApiClient;
  organizationId: string;
  scopes: string[];
};

/** Extract a bearer token from an Authorization header. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Authenticate a request's bearer token. Returns null for any failure —
 * missing, malformed, unknown, inactive or expired — so callers cannot
 * accidentally distinguish them in a response.
 */
export async function authenticateApiToken(
  authorizationHeader: string | null,
): Promise<ApiActor | null> {
  const token = bearerFrom(authorizationHeader);
  if (!token || !token.startsWith(PREFIX)) return null;

  const hash = hashToken(token);
  const client = await prisma.apiClient.findUnique({ where: { tokenHash: hash } });

  if (!client || !client.active) return null;
  if (!digestsEqual(client.tokenHash, hash)) return null;
  if (client.expiresAt && client.expiresAt <= new Date()) return null;

  // Best-effort usage tracking; never block the request on it.
  void prisma.apiClient
    .update({ where: { id: client.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return { client, organizationId: client.organizationId, scopes: client.scopes };
}

export function hasScope(actor: ApiActor, scope: string): boolean {
  return actor.scopes.includes(scope) || actor.scopes.includes('*');
}
