import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { currentActor } from '@/lib/auth/actor';
import { signIn } from '@/lib/auth/config';
import { env, ssoEnabled } from '@/lib/env';
import { VendorSignInForm } from './vendor-form';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  not_provisioned:
    'Your account is not provisioned for this platform. Ask an administrator to add you.',
  CredentialsSignin: 'Those credentials were not accepted. Check your password and code.',
  Configuration: 'Sign-in is not configured correctly. Contact an administrator.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await currentActor();
  if (actor) redirect('/');

  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? 'Sign-in failed. Please try again.') : null;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Non-Employee Risk Management
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to manage external workers
          </p>
        </div>

        {message && (
          <div
            role="alert"
            className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {message}
          </div>
        )}

        <div className="card p-6">
          {ssoEnabled ? (
            <form
              action={async () => {
                'use server';
                await signIn('oidc', { redirectTo: '/' });
              }}
            >
              <button type="submit" className="btn-primary w-full">
                Continue with {env.OIDC_PROVIDER_NAME}
              </button>
            </form>
          ) : (
            <p className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
              Single sign-on is not configured. Set <code>OIDC_ISSUER</code>,{' '}
              <code>OIDC_CLIENT_ID</code> and <code>OIDC_CLIENT_SECRET</code> to enable it.
            </p>
          )}

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Vendor administrators
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <VendorSignInForm />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Internal staff sign in with their corporate account. Vendor administrators use the
          credentials and authenticator app from their invitation.
        </p>
      </div>
    </div>
  );
}
