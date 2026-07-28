import { redirect } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { currentActor } from '@/lib/auth/actor';
import { isAdmin } from '@/lib/authz/scope';
import { listApiClients } from '@/lib/queries/admin';
import { AppShell } from '@/components/app-shell';
import { formatDateTime, relativeDays } from '@/lib/ui';

export const dynamic = 'force-dynamic';

export default async function ApiClientsPage() {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (!isAdmin(actor)) redirect('/');

  const clients = await listApiClients(actor);

  return (
    <AppShell actor={actor}>
      <h1 className="text-2xl font-semibold tracking-tight">API clients</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Tokens for the SCIM and REST surfaces. Only a SHA-256 digest is stored, so a token can
        never be shown again after it is issued — reissue instead of recovering.
      </p>

      <div className="mt-8 space-y-4">
        {clients.length === 0 ? (
          <div className="card px-6 py-16 text-center">
            <KeyRound className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No API clients yet.</p>
          </div>
        ) : (
          clients.map((client) => (
            <article key={client.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">{client.name}</h2>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {client.tokenPrefix}…
                  </div>
                </div>
                <span
                  className={
                    client.active
                      ? 'badge bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                  }
                >
                  {client.active ? 'Active' : 'Revoked'}
                </span>
              </div>

              <dl className="mt-4 grid gap-4 border-t border-border pt-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Scopes
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {client.scopes.map((scope) => (
                      <span key={scope} className="badge bg-muted font-mono text-muted-foreground">
                        {scope}
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Last used
                  </dt>
                  <dd className="mt-1">
                    {client.lastUsedAt ? relativeDays(client.lastUsedAt) : 'Never'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Created
                  </dt>
                  <dd className="mt-1">{formatDateTime(client.createdAt)}</dd>
                </div>
              </dl>
            </article>
          ))
        )}
      </div>

      <section className="card mt-8 p-5">
        <h2 className="font-semibold">Connecting Identity Security Cloud</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Point an ISC SCIM 2.0 source at the base URL below and authenticate with a bearer
          token holding the <code className="font-mono text-xs">scim:read</code> scope.
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="w-40 shrink-0 text-muted-foreground">SCIM base URL</dt>
            <dd className="font-mono text-xs">/scim/v2</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-40 shrink-0 text-muted-foreground">Discovery</dt>
            <dd className="font-mono text-xs">
              /scim/v2/ServiceProviderConfig · /scim/v2/Schemas · /scim/v2/ResourceTypes
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-40 shrink-0 text-muted-foreground">Custom schema</dt>
            <dd className="font-mono text-xs">urn:nerm:2.0:NonEmployee</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-40 shrink-0 text-muted-foreground">Incremental filter</dt>
            <dd className="font-mono text-xs">meta.lastModified gt &quot;…&quot;</dd>
          </div>
        </dl>
      </section>
    </AppShell>
  );
}
