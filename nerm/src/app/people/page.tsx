import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { LifecycleState } from '@prisma/client';
import { Search, UserPlus } from 'lucide-react';
import { currentActor } from '@/lib/auth/actor';
import { isVendorOnly } from '@/lib/authz/scope';
import { listPeople } from '@/lib/queries/people';
import { AppShell } from '@/components/app-shell';
import { LifecycleBadge, RiskBadge } from '@/components/badges';
import { LIFECYCLE_STYLES, formatDate } from '@/lib/ui';

export const dynamic = 'force-dynamic';

const STATES = Object.keys(LIFECYCLE_STYLES) as LifecycleState[];

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; expiring?: string; page?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (isVendorOnly(actor)) redirect('/vendor');

  const params = await searchParams;
  const state = STATES.includes(params.state as LifecycleState)
    ? (params.state as LifecycleState)
    : undefined;

  const { people, total, page, pages } = await listPeople(actor, {
    q: params.q,
    state,
    expiring: params.expiring === '1',
    page: Number(params.page ?? '1') || 1,
  });

  return (
    <AppShell actor={actor}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} {total === 1 ? 'record' : 'records'}
            {params.expiring === '1' && ' expiring within 30 days'}
          </p>
        </div>
        <Link href="/people/new" className="btn-primary">
          <UserPlus className="h-4 w-4" />
          Onboard someone
        </Link>
      </div>

      {/* Filters are a GET form so every view is a shareable, bookmarkable URL. */}
      <form className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor="q" className="label mb-1.5">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="q"
              name="q"
              defaultValue={params.q ?? ''}
              placeholder="Name, email or job title"
              className="input pl-9"
            />
          </div>
        </div>

        <div>
          <label htmlFor="state" className="label mb-1.5">
            Lifecycle state
          </label>
          <select id="state" name="state" defaultValue={state ?? ''} className="input">
            <option value="">All states</option>
            {STATES.map((value) => (
              <option key={value} value={value}>
                {LIFECYCLE_STYLES[value].label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="expiring"
            value="1"
            defaultChecked={params.expiring === '1'}
            className="h-4 w-4 rounded border-input"
          />
          Expiring soon
        </label>

        <button type="submit" className="btn-secondary">
          Apply
        </button>
      </form>

      {people.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No people match these filters.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* The table scrolls inside its own container so the page never does. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Vendor</Th>
                  <Th>Sponsor</Th>
                  <Th>Ends</Th>
                  <Th>Risk</Th>
                  <Th>State</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {people.map((person) => (
                  <tr key={person.id} className="hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <Link href={`/people/${person.id}`} className="block hover:underline">
                        <div className="font-medium">
                          {person.firstName} {person.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground">{person.email}</div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {person.profileType.name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {person.vendorCompany?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {person.sponsor?.name ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDate(person.endDate)}
                    </td>
                    <td className="px-4 py-3">
                      <RiskBadge tier={person.riskTier} />
                    </td>
                    <td className="px-4 py-3">
                      <LifecycleBadge state={person.lifecycleState} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Pagination">
          {page > 1 && (
            <Link
              href={buildHref(params, page - 1)}
              className="btn-secondary"
              rel="prev"
            >
              Previous
            </Link>
          )}
          <span className="px-3 text-sm text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={buildHref(params, page + 1)} className="btn-secondary" rel="next">
              Next
            </Link>
          )}
        </nav>
      )}
    </AppShell>
  );
}

function buildHref(params: Record<string, string | undefined>, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== 'page') search.set(key, value);
  }
  search.set('page', String(page));
  return `/people?${search.toString()}`;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  );
}
