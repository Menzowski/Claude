import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Building2, Clock, Lock, Mail, MapPin, UserCircle } from 'lucide-react';
import { currentActor } from '@/lib/auth/actor';
import { canWritePerson, isVendorOnly } from '@/lib/authz/scope';
import { getPerson } from '@/lib/queries/people';
import { transitionsFrom } from '@/lib/domain/lifecycle';
import { AppShell } from '@/components/app-shell';
import { LifecycleBadge, RiskBadge, TaskStatusBadge } from '@/components/badges';
import { formatDate, formatDateTime, relativeDays } from '@/lib/ui';
import { transitionPersonAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (isVendorOnly(actor)) redirect('/vendor');

  const { id } = await params;
  const { error } = await searchParams;

  const person = await getPerson(actor, id);
  if (!person) notFound();

  const writable = canWritePerson(actor, person);
  // Only offer transitions the state machine actually allows from here.
  const actions = writable ? transitionsFrom(person.lifecycleState, true) : [];

  return (
    <AppShell actor={actor}>
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link href="/people" className="hover:underline">
          People
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">
          {person.firstName} {person.lastName}
        </span>
      </nav>

      {error === 'illegal_transition' && (
        <div
          role="alert"
          className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          That change is no longer valid from this record&rsquo;s current state. The page has
          been refreshed.
        </div>
      )}

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {person.firstName} {person.lastName}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              {person.email}
            </span>
            {person.vendorCompany && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                {person.vendorCompany.name}
              </span>
            )}
            {person.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {person.location}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <LifecycleBadge state={person.lifecycleState} />
            <RiskBadge tier={person.riskTier} />
            <span className="badge bg-muted text-muted-foreground">
              {person.profileType.name}
            </span>
          </div>
        </div>

        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <form key={`${action.from}-${action.to}`} action={transitionPersonAction}>
                <input type="hidden" name="personId" value={person.id} />
                <input type="hidden" name="to" value={action.to} />
                <button
                  type="submit"
                  className={
                    action.to === 'REJECTED' || action.to === 'SUSPENDED'
                      ? 'btn-destructive'
                      : 'btn-secondary'
                  }
                >
                  {action.label}
                </button>
              </form>
            ))}
          </div>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card">
            <h2 className="border-b border-border px-5 py-4 font-semibold">Profile</h2>
            <dl className="grid gap-x-8 gap-y-4 px-5 py-5 sm:grid-cols-2">
              <Detail label="Job title" value={person.jobTitle} />
              <Detail label="Department" value={person.department} />
              <Detail label="Engagement type" value={person.type} />
              <Detail label="Sponsor" value={person.sponsor?.name} />
              <Detail label="Start date" value={formatDate(person.startDate)} />
              <Detail
                label="End date"
                value={
                  person.endDate
                    ? `${formatDate(person.endDate)} (${relativeDays(person.endDate)})`
                    : '—'
                }
              />
              <Detail label="External ID" value={person.externalId} mono />

              {person.resolvedAttributes.map((attribute) => (
                <div key={attribute.key}>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {attribute.label}
                  </dt>
                  <dd className="mt-1 text-sm">
                    {attribute.masked ? (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Lock className="h-3 w-3" />
                        {attribute.value}
                      </span>
                    ) : (
                      attribute.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="card">
            <h2 className="border-b border-border px-5 py-4 font-semibold">Workflows</h2>
            {person.workflows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No workflow has run for this person.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {person.workflows.map((instance) => (
                  <div key={instance.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">
                        {instance.definition.name}{' '}
                        <span className="text-xs font-normal text-muted-foreground">
                          v{instance.definition.version}
                        </span>
                      </div>
                      <span className="badge bg-muted text-muted-foreground">
                        {instance.status}
                      </span>
                    </div>

                    <ol className="mt-3 space-y-2">
                      {instance.tasks.map((task) => (
                        <li key={task.id} className="flex items-center justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <div className="truncate">{task.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {task.assignee ? `Assigned to ${task.assignee.name}` : 'Unassigned'}
                              {task.dueAt && ` · due ${relativeDays(task.dueAt)}`}
                            </div>
                          </div>
                          <TaskStatusBadge status={task.status} />
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* The timeline answers the auditor's question: who changed what, when. */}
        <section className="card lg:sticky lg:top-20 lg:self-start">
          <h2 className="border-b border-border px-5 py-4 font-semibold">Lifecycle history</h2>
          {person.transitions.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No changes recorded.
            </p>
          ) : (
            <ol className="space-y-0 px-5 py-4">
              {person.transitions.map((transition, index) => (
                <li key={transition.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < person.transitions.length - 1 && (
                    <div className="absolute left-[7px] top-5 h-full w-px bg-border" aria-hidden />
                  )}
                  <div className="relative mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-primary bg-background" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      <LifecycleBadge state={transition.to} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      from {transition.from.toLowerCase().replace('_', ' ')}
                    </div>
                    {transition.reason && (
                      <div className="mt-1 text-xs italic text-muted-foreground">
                        “{transition.reason}”
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDateTime(transition.createdAt)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <UserCircle className="h-3 w-3" />
                      {transition.actorKind === 'SYSTEM' ? 'System' : 'User action'}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? 'mt-1 font-mono text-xs' : 'mt-1 text-sm'}>{value || '—'}</dd>
    </div>
  );
}
