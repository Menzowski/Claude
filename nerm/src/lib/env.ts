import { z } from 'zod';

/**
 * Environment is validated once, at import. A misconfigured deployment should
 * fail loudly on boot rather than at the first request that happens to need
 * the missing value.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),

  AUTH_SECRET: z.string().min(16),
  AUTH_URL: z.string().url().default('http://localhost:3000'),

  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_PROVIDER_NAME: z.string().default('Corporate SSO'),
  OIDC_SCOPES: z.string().optional(),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('eu-west-1'),
  S3_BUCKET: z.string().default('nerm-attachments'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  EXPIRY_WARNING_DAYS: z.coerce.number().int().positive().default(30),
  JOB_TRIGGER_SECRET: z.string().optional(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${detail}`);
}

export const env = parsed.data;

/** SSO is only wired up when a full OIDC triple is present. */
export const ssoEnabled = Boolean(
  env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET,
);
