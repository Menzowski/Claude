import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { currentActor } from '@/lib/auth/actor';
import { isAdmin } from '@/lib/authz/scope';
import { listVendorsWithAdministrators } from '@/lib/queries/vendors';
import { AppShell } from '@/components/app-shell';
import { formatDate, relativeDays } from '@/lib/ui';

export const dynamic = 'force-dynamic';

export default async function VendorsPage() {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (!isAdmin(actor)) redirect('/');

  const vendors = await listVendorsWithAdministrators(actor);

  return (
    <AppShell actor={actor}>
      <h1 className="text-2xl font-semibold tracking-tight">Vendor companies</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Each vendor administrator is scoped to exactly one company and can see nothing outside
        it.
      </p>

      <div className="mt-8 space-y-4">
        {vendors.map((vendor) => {
          const contractEnding =
            vendor.contractEnd !== null &&
            vendor.contractEnd.getTime() - Date.now() < 90 * 24 * 60 * 60 * 1000;

          return (
            <article key={vendor.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="flex items-center gap-2 font-semibold">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {vendor.name}
                  </h2>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {vendor._count.people} {vendor._count.people === 1 ? 'person' : 'people'}
                    {vendor.externalId && ` · ${vendor.externalId}`}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <span
                    className={
                      vendor.status === 'ACTIVE'
                        ? 'badge bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'badge bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                    }
                  >
                    {vendor.status}
                  </span>
                  {vendor.contractEnd && (
                    <div
                      className={
                        contractEnding
                          ? 'mt-1 text-xs font-medium text-orange-600 dark:text-orange-400'
                          : 'mt-1 text-xs text-muted-foreground'
                      }
                    >
                      Contract ends {formatDate(vendor.contractEnd)} (
                      {relativeDays(vendor.contractEnd)})
                    </div>
                  )}
                </div>
              </div>

              <dl className="mt-4 grid gap-4 border-t border-border pt-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Internal owner
                  </dt>
                  <dd className="mt-1">{vendor.owner?.name ?? 'Unassigned'}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Vendor administrators
                  </dt>
                  <dd className="mt-1">
                    {vendor.assignments.length === 0 ? (
                      <span className="text-muted-foreground">None invited</span>
                    ) : (
                      <ul className="space-y-1">
                        {vendor.assignments.map((assignment) => (
                          <li key={assignment.id}>
                            {assignment.user.name}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {assignment.user.lastLoginAt
                                ? `last signed in ${relativeDays(assignment.user.lastLoginAt)}`
                                : 'never signed in'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
