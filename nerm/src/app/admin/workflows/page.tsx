import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GitBranch, Plus } from 'lucide-react';
import { currentActor } from '@/lib/auth/actor';
import { isAdmin } from '@/lib/authz/scope';
import { listDefinitions } from '@/lib/workflow/definitions';
import { AppShell } from '@/components/app-shell';
import { formatDate } from '@/lib/ui';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage() {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (!isAdmin(actor)) redirect('/');

  const definitions = await listDefinitions(actor.organizationId);

  return (
    <AppShell actor={actor}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Definitions are versioned JSON. Edit them here or through the REST API — both
            write the same document.
          </p>
        </div>
        <Link href="/admin/workflows/new" className="btn-primary">
          <Plus className="h-4 w-4" />
          New workflow
        </Link>
      </div>

      {definitions.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <GitBranch className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No workflows defined yet.</p>
        </div>
      ) : (
        <div className="card divide-y divide-border">
          {definitions.map((definition) => (
            <Link
              key={definition.key}
              href={`/admin/workflows/${definition.key}`}
              className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 hover:bg-accent"
            >
              <div className="min-w-0">
                <div className="font-medium">{definition.name}</div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {definition.key}
                </div>
                {definition.description && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    {definition.description}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm">
                <span className="text-muted-foreground">
                  latest v{definition.version} · {formatDate(definition.createdAt)}
                </span>
                {definition.activeVersion !== null ? (
                  <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    v{definition.activeVersion} active
                  </span>
                ) : (
                  <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    No active version
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
