import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Building2, UserPlus } from 'lucide-react';
import { currentActor } from '@/lib/auth/actor';
import { isVendorOnly } from '@/lib/authz/scope';
import { getVendorPortalData } from '@/lib/queries/vendors';
import { AppShell } from '@/components/app-shell';
import { LifecycleBadge } from '@/components/badges';
import { formatDate, relativeDays } from '@/lib/ui';

export const dynamic = 'force-dynamic';

/**
 * The vendor roster.
 *
 * Everything here is read through `personScope`, which for a vendor
 * administrator resolves to their own vendor and nothing else. There is no
 * "all people" query on this page that a filter bug could widen.
 */
export default async function VendorHomePage() {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (!isVendorOnly(actor)) redirect('/');

  const { vendors, people } = await getVendorPortalData(actor);

  const active = people.filter((p) => p.lifecycleState === 'ACTIVE').length;
  const pending = people.filter((p) => p.lifecycleState === 'PENDING_APPROVAL').length;

  return (
    <AppShell actor={actor}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Our people</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {vendors.map((vendor) => (
              <span key={vendor.id} className="inline-flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                {vendor.name}
                {vendor.contractEnd && (
                  <span className="text-xs">
                    (contract ends {formatDate(vendor.contractEnd)})
                  </span>
                )}
              </span>
            ))}
          </p>
        </div>
        <Link href="/vendor/new" className="btn-primary">
          <UserPlus className="h-4 w-4" />
          Submit a worker
        </Link>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Total" value={people.length} />
        <Stat label="Active" value={active} />
        <Stat label="Awaiting approval" value={pending} />
      </div>

      {people.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            You have not submitted anyone yet.
          </p>
          <Link href="/vendor/new" className="btn-primary mt-4">
            Submit your first worker
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Sponsor</Th>
                  <Th>Ends</Th>
                  <Th>State</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {people.map((person) => (
                  <tr key={person.id} className="hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {person.firstName} {person.lastName}
                      </div>
                      <div className="text-xs text-muted-foreground">{person.email}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {person.jobTitle ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {person.sponsor?.name ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {person.endDate ? (
                        <>
                          {formatDate(person.endDate)}
                          <span className="ml-1 text-xs">({relativeDays(person.endDate)})</span>
                        </>
                      ) : (
                        '—'
                      )}
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
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card px-5 py-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
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
