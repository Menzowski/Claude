import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckCircle2, Clock } from 'lucide-react';
import { currentActor } from '@/lib/auth/actor';
import { isVendorOnly } from '@/lib/authz/scope';
import { listPendingTasks, listRecentlyDecidedTasks } from '@/lib/queries/tasks';
import { AppShell } from '@/components/app-shell';
import { TaskStatusBadge } from '@/components/badges';
import { cn, formatDate, relativeDays } from '@/lib/ui';
import { decideTaskAction } from './actions';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  not_found: 'That task no longer exists, or is outside what you can see.',
  forbidden: 'That task is not assigned to you.',
  already_decided: 'That task had already been decided.',
  invalid_decision: 'That is not a valid decision.',
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; decided?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (isVendorOnly(actor)) redirect('/vendor/tasks');

  const { error, decided } = await searchParams;

  const [pending, recent] = await Promise.all([
    listPendingTasks(actor),
    listRecentlyDecidedTasks(actor),
  ]);

  return (
    <AppShell actor={actor}>
      <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {pending.length === 0
          ? 'Nothing is waiting on you.'
          : `${pending.length} ${pending.length === 1 ? 'task needs' : 'tasks need'} your decision.`}
      </p>

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {ERRORS[error] ?? 'Something went wrong.'}
        </div>
      )}

      {decided === '1' && (
        <div className="mt-6 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          Decision recorded.
        </div>
      )}

      <div className="mt-8 space-y-4">
        {pending.map((task) => {
          const overdue = task.dueAt !== null && task.dueAt < new Date();
          const person = task.instance.person;

          return (
            <article key={task.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-semibold">{task.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <Link href={`/people/${person.id}`} className="hover:underline">
                      {person.firstName} {person.lastName}
                    </Link>
                    {' · '}
                    {task.instance.definition.name}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className={cn('inline-flex items-center gap-1', overdue && 'font-medium text-destructive')}>
                      <Clock className="h-3 w-3" />
                      {task.dueAt ? `Due ${relativeDays(task.dueAt)}` : 'No due date'}
                    </span>
                    <span>Risk: {person.riskTier.toLowerCase()}</span>
                    {person.endDate && <span>Engagement ends {formatDate(person.endDate)}</span>}
                  </div>
                </div>
              </div>

              <form action={decideTaskAction} className="mt-4 border-t border-border pt-4">
                <input type="hidden" name="taskId" value={task.id} />

                <label htmlFor={`comment-${task.id}`} className="label mb-1.5">
                  Comment{' '}
                  <span className="font-normal text-muted-foreground">
                    (required when rejecting)
                  </span>
                </label>
                <textarea
                  id={`comment-${task.id}`}
                  name="comment"
                  rows={2}
                  className="input"
                  placeholder="Why are you approving or rejecting this?"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                  {task.kind === 'APPROVAL' ? (
                    <>
                      <button
                        type="submit"
                        name="decision"
                        value="APPROVED"
                        className="btn-primary"
                      >
                        Approve
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="REJECTED"
                        className="btn-destructive"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <button
                      type="submit"
                      name="decision"
                      value="COMPLETED"
                      className="btn-primary"
                    >
                      Mark complete
                    </button>
                  )}
                </div>
              </form>
            </article>
          );
        })}

        {pending.length === 0 && (
          <div className="card px-6 py-16 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Your queue is clear.</p>
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recently decided
          </h2>
          <div className="card divide-y divide-border">
            {recent.map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm">{task.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {task.instance.person.firstName} {task.instance.person.lastName}
                  </div>
                </div>
                <TaskStatusBadge status={task.status} />
              </div>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
