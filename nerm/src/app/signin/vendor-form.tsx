'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

/**
 * Vendor sign-in: password plus a TOTP code. MFA is not optional for external
 * accounts, so the code field is always present rather than appearing as a
 * second step someone might be allowed to skip.
 */
export function VendorSignInForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const result = await signIn('vendor', {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      totp: String(data.get('totp') ?? ''),
      redirect: false,
    });

    setPending(false);

    if (result?.error) {
      // Deliberately non-specific: telling the user which factor failed tells
      // an attacker the same thing.
      setError('Those credentials were not accepted.');
      return;
    }

    window.location.href = '/vendor';
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div>
        <label htmlFor="email" className="label mb-1.5">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="input"
          placeholder="you@vendor.example"
        />
      </div>

      <div>
        <label htmlFor="password" className="label mb-1.5">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </div>

      <div>
        <label htmlFor="totp" className="label mb-1.5">
          Authenticator code
        </label>
        <input
          id="totp"
          name="totp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          className="input tracking-[0.3em]"
          placeholder="000000"
        />
      </div>

      <button type="submit" disabled={pending} className="btn-secondary w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
