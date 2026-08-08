import { redirect } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { currentActor } from '@/lib/auth/actor';
import { isVendorOnly } from '@/lib/authz/scope';
import { listPendingTasks } from '@/lib/queries/tasks';
import { AppShell } from '@/components/app-shell';
import { relativeDays } from '@/lib/ui';
import { decideTaskAction } from '@/app/tasks/actions';

export const dynamic = 'force-dynamic';

/** Tasks assigned to a vendor administrator — document uploads and checklists. */
export default async function VendorTasksPage() {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (!isVendorOnly(actor)) redirect('/tasks');

  const tasks = await listPendingTasks(actor);

  return (
    <AppShell actor={actor}>
      <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {tasks.length === 0 ? 'Nothing is waiting on you.' : `${tasks.length} open.`}
      </p>

      <div className="mt-8 space-y-4">
        {tasks.map((task) => (
          <article key={task.id} className="card p-5">
            <h2 className="font-semibold">{task.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {task.instance.person.firstName} {task.instance.person.lastName}
              {task.dueAt && ` · due ${relativeDays(task.dueAt)}`}
            </p>

            <form action={decideTaskAction} className="mt-4 border-t border-border pt-4">
              <input type="hidden" name="taskId" value={task.id} />
              <textarea
                name="comment"
                rows={2}
                className="input"
                placeholder="Add a note (optional)"
                aria-label="Comment"
              />
              <button
                type="submit"
                name="decision"
                value="COMPLETED"
                className="btn-primary mt-3"
              >
                Mark complete
              </button>
            </form>
          </article>
        ))}

        {tasks.length === 0 && (
          <div className="card px-6 py-16 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Your queue is clear.</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
