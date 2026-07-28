import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentActor } from '@/lib/auth/actor';
import { isAdmin } from '@/lib/authz/scope';
import { getVersions } from '@/lib/workflow/definitions';
import { AppShell } from '@/components/app-shell';
import { formatDateTime } from '@/lib/ui';
import { WorkflowEditor } from '../editor';
import { ActivateButton } from './activate-button';

export const dynamic = 'force-dynamic';

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (!isAdmin(actor)) redirect('/');

  const { key } = await params;
  const versions = await getVersions(actor.organizationId, key);
  if (versions.length === 0) notFound();

  const latest = versions[0]!;
  const activeVersion = versions.find((v) => v.active);

  return (
    <AppShell actor={actor}>
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link href="/admin/workflows" className="hover:underline">
          Workflows
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{key}</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{latest.name}</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{key}</p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          {activeVersion ? (
            <>
              Version {activeVersion.version} is active
              <div className="text-xs">New instances start on this version.</div>
            </>
          ) : (
            <span className="text-destructive">No active version</span>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <WorkflowEditor
            workflowKey={key}
            initialDefinition={JSON.stringify(latest.definition, null, 2)}
            latestVersion={latest.version}
          />
        </div>

        <section className="card lg:sticky lg:top-20 lg:self-start">
          <h2 className="border-b border-border px-5 py-4 font-semibold">Version history</h2>
          <ul className="divide-y divide-border">
            {versions.map((version) => (
              <li key={version.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      Version {version.version}
                      {version.active && (
                        <span className="ml-2 badge bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatDateTime(version.createdAt)}
                    </div>
                  </div>
                  {!version.active && (
                    <ActivateButton workflowKey={key} version={version.version} />
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            Published versions are immutable. Saving creates a new version; instances already
            running keep the version they started on.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
