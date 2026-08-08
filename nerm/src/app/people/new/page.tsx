import { redirect } from 'next/navigation';
import { currentActor } from '@/lib/auth/actor';
import { isVendorOnly } from '@/lib/authz/scope';
import { listAssignableVendors } from '@/lib/queries/vendors';
import { listActiveWorkflows } from '@/lib/queries/admin';
import { getProfileTypes, getSponsorOptions } from '@/lib/queries/people';
import { AppShell } from '@/components/app-shell';
import { OnboardingWizard } from './wizard';

export const dynamic = 'force-dynamic';

export default async function NewPersonPage() {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (isVendorOnly(actor)) redirect('/vendor/new');

  // The active workflows are fetched so the wizard can show which one a profile
  // type will trigger — the sponsor should know what they are starting before
  // they start it.
  const [profileTypes, sponsors, vendors, workflows] = await Promise.all([
    getProfileTypes(actor.organizationId),
    getSponsorOptions(actor.organizationId),
    listAssignableVendors(actor),
    listActiveWorkflows(actor.organizationId),
  ]);

  return (
    <AppShell actor={actor}>
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Onboard a non-employee</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The form adapts to the profile type you choose. Required fields are marked with an
          asterisk.
        </p>

        <OnboardingWizard
          profileTypes={profileTypes}
          sponsors={sponsors}
          vendors={vendors}
          workflows={workflows}
          defaultSponsorId={actor.userId}
        />
      </div>
    </AppShell>
  );
}
