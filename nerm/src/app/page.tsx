import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, CalendarClock, CheckCircle2, Clock, UserPlus, Users } from 'lucide-react';
import { currentActor } from '@/lib/auth/actor';
import { isVendorOnly } from '@/lib/authz/scope';
import { getDashboard } from '@/lib/queries/dashboard';
import { AppShell } from '@/components/app-shell';
import { LifecycleBadge } from '@/components/badges';
import { cn, formatDate, relativeDays } from '@/lib/ui';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (isVendorOnly(actor)) redirect('/vendor');

  const { total, active, pending, expiring, myPeople, myTasks } = await getDashboard(actor);
  const firstName = actor.name.split(' ')[0] ?? actor.name;

  return (
    <AppShell actor={actor}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Good day, {firstName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {myTasks.length > 0
              ? `You have ${myTasks.length} ${myTasks.length === 1 ? 'task' : 'tasks'} waiting.`
              : 'Nothing is waiting on you right now.'}
          </p>
        </div>
        <Link href="/people/new" className="btn-primary">
          <UserPlus className="h-4 w-4" />
          Onboard someone
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Users} label="Total non-employees" value={total} href="/people" />
        <Stat icon={CheckCircle2} label="Active" value={active} href="/people?state=ACTIVE" />
        <Stat
          icon={Clock}
          label="Awaiting approval"
          value={pending}
          href="/people?state=PENDING_APPROVAL"
          emphasis={pending > 0}
        />
        <Stat
          icon={CalendarClock}
          label="Expiring in 30 days"
          value={expiring}
          href="/people?expiring=1"
          emphasis={expiring > 0}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Tasks first: the point of the home screen is what to do next. */}
        <section className="card">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-semibold">Your tasks</h2>
            <Link href="/tasks" className="text-sm text-primary hover:underline">
              View all
            </Link>
          </header>

          {myTasks.length === 0 ? (
            <Empty message="No open tasks." />
          ) : (
            <ul className="divide-y divide-border">
              {myTasks.map((task) => {
                const overdue = task.dueAt !== null && task.dueAt < new Date();
                return (
                  <li key={task.id}>
                    <Link
                      href={`/tasks/${task.id}`}
                      className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-accent"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{task.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {task.instance.person.firstName} {task.instance.person.lastName}
                        </div>
                      </div>
                      <div
                        className={cn(
                          'shrink-0 text-xs',
                          overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {task.dueAt ? `Due ${relativeDays(task.dueAt)}` : 'No due date'}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-semibold">Your people</h2>
            <Link href="/people" className="text-sm text-primary hover:underline">
              View all
            </Link>
          </header>

          {myPeople.length === 0 ? (
            <Empty message="You are not sponsoring anyone yet." />
          ) : (
            <ul className="divide-y divide-border">
              {myPeople.map((person) => (
                <li key={person.id}>
                  <Link
                    href={`/people/${person.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {person.firstName} {person.lastName}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {person.vendorCompany?.name ?? person.department ?? person.email}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        {person.endDate ? `Ends ${formatDate(person.endDate)}` : 'No end date'}
                      </span>
                      <LifecycleBadge state={person.lifecycleState} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  href,
  emphasis = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  href: string;
  emphasis?: boolean;
}) {
  return (
    <Link href={href} className="card group px-5 py-4 transition-colors hover:bg-accent">
      <div className="flex items-center justify-between">
        <Icon
          className={cn('h-4 w-4', emphasis ? 'text-orange-500' : 'text-muted-foreground')}
        />
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </Link>
  );
}

function Empty({ message }: { message: string }) {
  return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{message}</p>;
}
