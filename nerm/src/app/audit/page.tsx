import { redirect } from 'next/navigation';
import { currentActor } from '@/lib/auth/actor';
import { isAdmin, isAuditor } from '@/lib/authz/scope';
import { listAuditEvents } from '@/lib/queries/admin';
import { AppShell } from '@/components/app-shell';
import { formatDateTime } from '@/lib/ui';

export const dynamic = 'force-dynamic';

type Change = { field: string; from: unknown; to: unknown };

/**
 * The audit log.
 *
 * Restricted to administrators and auditors, and read through `auditScope`
 * which returns a non-matching filter for anyone else. Sensitive field values
 * were already masked when the event was written, so this page cannot leak them
 * even to a reader who is entitled to be here.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; subject?: string; page?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (!isAdmin(actor) && !isAuditor(actor)) redirect('/');

  const params = await searchParams;

  const { events, total, page, pages } = await listAuditEvents(actor, {
    action: params.action,
    subjectType: params.subject,
    page: Number(params.page ?? '1') || 1,
  });

  return (
    <AppShell actor={actor}>
      <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {total} recorded {total === 1 ? 'event' : 'events'}. The log is append-only — the
        database rejects updates and deletes.
      </p>

      <form className="card mb-6 mt-6 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="action" className="label mb-1.5">
            Action
          </label>
          <input
            id="action"
            name="action"
            defaultValue={params.action ?? ''}
            placeholder="person.created"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="subject" className="label mb-1.5">
            Subject type
          </label>
          <select id="subject" name="subject" defaultValue={params.subject ?? ''} className="input">
            <option value="">All</option>
            <option value="Person">Person</option>
            <option value="User">User</option>
            <option value="WorkflowTask">Workflow task</option>
            <option value="WorkflowInstance">Workflow instance</option>
            <option value="WorkflowDefinition">Workflow definition</option>
          </select>
        </div>
        <button type="submit" className="btn-secondary">
          Filter
        </button>
      </form>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Actor</Th>
                <Th>Subject</Th>
                <Th>Changes</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((event) => {
                const changes = Array.isArray(event.changes)
                  ? (event.changes as unknown as Change[])
                  : [];

                return (
                  <tr key={event.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs">{event.action}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>{event.actorLabel ?? '—'}</div>
                      <div className="text-muted-foreground">{event.actorKind}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>{event.subjectType}</div>
                      {event.subjectId && (
                        <div className="font-mono text-muted-foreground">
                          {event.subjectId.slice(0, 12)}…
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {changes.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {changes.map((change, index) => (
                            <li key={index}>
                              <span className="font-medium">{change.field}</span>:{' '}
                              <span className="text-muted-foreground">
                                {format(change.from)} → {format(change.to)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pagination">
          {page > 1 && (
            <a href={`/audit?page=${page - 1}`} className="btn-secondary">
              Previous
            </a>
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <a href={`/audit?page=${page + 1}`} className="btn-secondary">
              Next
            </a>
          )}
        </nav>
      )}
    </AppShell>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return String(value);
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </th>
  );
}
