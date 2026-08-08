import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { verify } from '@node-rs/argon2';
import { authenticator } from 'otplib';
import { prisma } from '@/lib/db';
import { demoModeEnabled, env, ssoEnabled } from '@/lib/env';
import { writeAudit } from '@/lib/audit';

/**
 * Sign-in paths, deliberately kept separate:
 *
 *   Internal users  — corporate IdP over OIDC. Config-driven, so the same build
 *                     runs against Entra ID, Okta, Keycloak or ISC by changing
 *                     environment variables only.
 *   Vendor admins   — invited, with a local password and mandatory TOTP. We do
 *                     not federate every supplier's IdP in v1, and we do not
 *                     let external accounts in without a second factor.
 *   Demo            — a shared password standing in for the IdP, so the product
 *                     can be shown on hosting with no IdP attached. Registered
 *                     only when DEMO_MODE is on; see below.
 *
 * Accounts are never created by signing in. An internal user must already exist
 * (provisioned by an administrator) before OIDC will admit them — otherwise
 * anyone in the corporate directory would silently gain a session.
 */

const providers: NextAuthConfig['providers'] = [];

if (ssoEnabled) {
  providers.push({
    id: 'oidc',
    name: env.OIDC_PROVIDER_NAME,
    type: 'oidc',
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    authorization: {
      params: {
        scope: ['openid', 'profile', 'email', env.OIDC_SCOPES ?? '']
          .filter(Boolean)
          .join(' '),
      },
    },
    checks: ['pkce', 'state'],
  });
}

providers.push(
  Credentials({
    id: 'vendor',
    name: 'Vendor account',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
      totp: { label: 'Authenticator code', type: 'text' },
    },
    async authorize(raw) {
      const email = String(raw?.email ?? '').trim().toLowerCase();
      const password = String(raw?.password ?? '');
      const totp = String(raw?.totp ?? '').trim();

      if (!email || !password) return null;

      const user = await prisma.user.findFirst({
        where: { email, kind: 'EXTERNAL', active: true },
      });

      // Uniform failure: never reveal whether the address exists.
      if (!user?.passwordHash) return null;

      const passwordOk = await verify(user.passwordHash, password).catch(() => false);
      if (!passwordOk) return null;

      // MFA is mandatory for external accounts, not optional.
      if (!user.totpSecret || !user.totpConfirmedAt) return null;
      if (!authenticator.verify({ token: totp, secret: user.totpSecret })) return null;

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      await writeAudit({
        organizationId: user.organizationId,
        action: 'auth.login',
        actor: { kind: 'USER', id: user.id, label: user.email },
        subjectType: 'User',
        subjectId: user.id,
        metadata: { method: 'vendor-credentials' },
      });

      return { id: user.id, email: user.email, name: user.name };
    },
  }),
);

/**
 * Demo sign-in.
 *
 * Substitutes a shared password for the corporate IdP so that the sponsor
 * console, workflow editor and audit log are reachable on a deployment with no
 * IdP attached. It is registered only when demo mode is fully configured — an
 * unset flag means this provider does not exist, rather than existing in a
 * disabled state that a later refactor might switch back on.
 *
 * What it deliberately does NOT relax:
 *
 *   * The user must already be provisioned and active. This replaces the
 *     identity provider, not the entitlement decision.
 *   * It admits INTERNAL users only. External vendor accounts keep their
 *     mandatory TOTP — there is no path here that skips a second factor for
 *     an account that is supposed to have one.
 *   * Authorization is untouched. A demo session resolves through the same
 *     `currentActor` -> `personScope` chain as any other, so role scoping and
 *     vendor isolation behave identically.
 *
 * The audit log records `method: 'demo'`, so sessions established this way are
 * distinguishable after the fact.
 */
if (demoModeEnabled) {
  providers.push(
    Credentials({
      id: 'demo',
      name: 'Demo sign-in',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Demo password', type: 'password' },
      },
      async authorize(raw) {
        const email = String(raw?.email ?? '').trim().toLowerCase();
        const password = String(raw?.password ?? '');

        if (!email || !password) return null;
        if (password !== env.DEMO_PASSWORD) return null;

        const user = await prisma.user.findFirst({
          where: { email, kind: 'INTERNAL', active: true },
        });
        if (!user) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        await writeAudit({
          organizationId: user.organizationId,
          action: 'auth.login',
          actor: { kind: 'USER', id: user.id, label: user.email },
          subjectType: 'User',
          subjectId: user.id,
          metadata: { method: 'demo' },
        });

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  providers,
  secret: env.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/signin', error: '/signin' },
  trustHost: true,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'oidc') return true;

      const email = (profile?.email ?? user.email ?? '').toLowerCase();
      if (!email) return false;

      const existing = await prisma.user.findFirst({
        where: { email, kind: 'INTERNAL', active: true },
      });

      // Provisioning is an administrative act. A valid corporate token is not
      // by itself an entitlement to this platform.
      if (!existing) return '/signin?error=not_provisioned';

      // Bind the OIDC subject on first successful sign-in so later logins match
      // on the stable subject rather than a mutable email address.
      if (!existing.oidcSubject && account.providerAccountId) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { oidcSubject: account.providerAccountId, lastLoginAt: new Date() },
        });
      } else {
        await prisma.user.update({
          where: { id: existing.id },
          data: { lastLoginAt: new Date() },
        });
      }

      await writeAudit({
        organizationId: existing.organizationId,
        action: 'auth.login',
        actor: { kind: 'USER', id: existing.id, label: existing.email },
        subjectType: 'User',
        subjectId: existing.id,
        metadata: { method: 'oidc' },
      });

      return true;
    },

    async jwt({ token, user, account }) {
      if (account?.provider === 'oidc' && token.email) {
        const record = await prisma.user.findFirst({
          where: { email: token.email.toLowerCase(), kind: 'INTERNAL' },
          select: { id: true },
        });
        if (record) token.userId = record.id;
      } else if (user?.id) {
        token.userId = user.id;
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string;
      return session;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
