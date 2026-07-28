import { redirect } from 'next/navigation';
import { Info } from 'lucide-react';
import { currentActor } from '@/lib/auth/actor';
import { isVendorOnly } from '@/lib/authz/scope';
import { getProfileTypes } from '@/lib/queries/people';
import { AppShell } from '@/components/app-shell';
import { VendorSubmitForm } from './form';

export const dynamic = 'force-dynamic';

export default async function VendorNewPersonPage() {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (!isVendorOnly(actor)) redirect('/people/new');

  const profileTypes = await getProfileTypes(actor.organizationId);

  // Vendor administrators only ever see the attributes marked vendor-editable —
  // internal-only fields such as cost centre are not theirs to set.
  const visibleTypes = profileTypes.map((type) => ({
    ...type,
    attributes: type.attributes.filter((attribute) => attribute.vendorEditable),
  }));

  return (
    <AppShell actor={actor}>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Submit a worker</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your submission goes to the sponsor at the client for approval.
        </p>

        <div className="mt-6 flex gap-3 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            The record is created against your company and routed to your account manager. You
            will see its status on the roster once it is submitted.
          </p>
        </div>

        <VendorSubmitForm profileTypes={visibleTypes} />
      </div>
    </AppShell>
  );
}
