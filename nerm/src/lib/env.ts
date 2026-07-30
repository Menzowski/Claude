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

  // -------------------------------------------------------------------------
  // Demo mode
  // -------------------------------------------------------------------------
  // Lets internal users sign in with a shared password instead of the corporate
  // IdP, so the product can be shown on hosting that has no IdP attached. It is
  // a deliberate weakening of authentication and is off unless explicitly asked
  // for. Never enable it on a deployment holding real personal data.
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  DEMO_PASSWORD: z.string().optional(),
  /** Fixed API token for the hosted demo, so the Postman collection works. */
  DEMO_API_TOKEN: z.string().optional(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
}).superRefine((value, ctx) => {
  // Half-configured demo mode is the dangerous state: a deployer who sets the
  // flag and forgets the password would otherwise get a provider guarding
  // privileged accounts with an empty string. Refuse to boot instead.
  if (value.DEMO_MODE && (value.DEMO_PASSWORD ?? '').length < 12) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DEMO_PASSWORD'],
      message:
        'DEMO_MODE=true requires DEMO_PASSWORD of at least 12 characters. ' +
        'Unset DEMO_MODE to disable demo sign-in entirely.',
    });
  }
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

/**
 * Whether the shared-password sign-in path for internal users is live.
 *
 * Read this rather than `env.DEMO_MODE` at call sites, so the password check
 * travels with the flag and there is one answer to "is demo sign-in possible".
 */
export const demoModeEnabled = env.DEMO_MODE && Boolean(env.DEMO_PASSWORD);
