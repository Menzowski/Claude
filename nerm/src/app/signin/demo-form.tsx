'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

/**
 * Demo sign-in for internal roles.
 *
 * Only rendered when the server has demo mode configured — the provider does
 * not exist otherwise, so this form would fail even if it were somehow shown.
 *
 * The account picker is a convenience, not a security boundary: the server
 * still requires the address to belong to a provisioned, active internal user,
 * and still checks the shared password.
 */
const DEMO_ACCOUNTS = [
  { email: 'admin.iam@example.com', label: 'Ada Admin — IAM administrator' },
  { email: 'sam.sponsor@example.com', label: 'Sam Sponsor — sponsor' },
  { email: 'sofia.sponsor@example.com', label: 'Sofia Sponsor — sponsor' },
  { email: 'iris.auditor@example.com', label: 'Iris Auditor — auditor' },
];

export function DemoSignInForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const result = await signIn('demo', {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      redirect: false,
    });

    setPending(false);

    if (result?.error) {
      setError('That did not work. Check the demo password.');
      return;
    }

    window.location.href = '/';
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div>
        <label htmlFor="demo-email" className="label mb-1.5">
          Sign in as
        </label>
        <select id="demo-email" name="email" className="input" defaultValue={DEMO_ACCOUNTS[0]!.email}>
          {DEMO_ACCOUNTS.map((account) => (
            <option key={account.email} value={account.email}>
              {account.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          Each role sees a different application. Start with the administrator.
        </p>
      </div>

      <div>
        <label htmlFor="demo-password" className="label mb-1.5">
          Demo password
        </label>
        <input
          id="demo-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </div>

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
