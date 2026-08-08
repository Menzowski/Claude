'use client';

import { useActionState, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AttributeDefinition, ProfileType } from '@prisma/client';
import { AlertCircle, ArrowLeft, ArrowRight, GitBranch, Loader2 } from 'lucide-react';
import { createPersonAction, type ActionResult } from '../actions';
import { AttributeField } from '@/components/attribute-field';

type ProfileTypeWithAttributes = ProfileType & { attributes: AttributeDefinition[] };

type Props = {
  profileTypes: ProfileTypeWithAttributes[];
  sponsors: { id: string; name: string; email: string }[];
  vendors: { id: string; name: string }[];
  workflows: { key: string; name: string; description: string | null }[];
  defaultSponsorId: string;
};

const STEPS = ['Type', 'Person', 'Engagement', 'Details', 'Review'] as const;

/**
 * A stepped form rather than one long page. Onboarding asks for a lot, and a
 * single wall of forty fields is where sponsors give up — each step is one
 * question a sponsor can answer without looking anything up.
 *
 * All fields stay mounted (hidden steps use `hidden`) so a single form POST
 * carries everything and the browser's own validation still applies.
 */
export function OnboardingWizard({
  profileTypes,
  sponsors,
  vendors,
  workflows,
  defaultSponsorId,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [profileTypeId, setProfileTypeId] = useState(profileTypes[0]?.id ?? '');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await createPersonAction(previous, formData);
      if (result.ok && result.personId) router.push(`/people/${result.personId}`);
      return result;
    },
    null,
  );

  const selectedType = useMemo(
    () => profileTypes.find((type) => type.id === profileTypeId),
    [profileTypes, profileTypeId],
  );

  const workflow = useMemo(
    () => workflows.find((w) => w.key === selectedType?.workflowKey),
    [workflows, selectedType],
  );

  const issuesByPath = useMemo(() => {
    const map = new Map<string, string>();
    if (state && !state.ok) {
      for (const issue of state.issues ?? []) map.set(issue.path, issue.message);
    }
    return map;
  }, [state]);

  return (
    <form action={formAction} className="mt-8">
      <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <div
              className={[
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                index < step
                  ? 'bg-primary text-primary-foreground'
                  : index === step
                    ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                    : 'bg-muted text-muted-foreground',
              ].join(' ')}
              aria-current={index === step ? 'step' : undefined}
            >
              {index + 1}
            </div>
            <span
              className={[
                'hidden text-sm sm:inline',
                index === step ? 'font-medium' : 'text-muted-foreground',
              ].join(' ')}
            >
              {label}
            </span>
            {index < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
          </li>
        ))}
      </ol>

      {state && !state.ok && (
        <div
          role="alert"
          className="mb-6 flex gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{state.message}</p>
            {state.issues && state.issues.length > 0 && (
              <ul className="mt-1 list-inside list-disc">
                {state.issues.map((issue) => (
                  <li key={issue.path}>
                    {issue.path}: {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="card p-6">
        {/* Step 1 — profile type */}
        <fieldset hidden={step !== 0} className="space-y-4">
          <legend className="sr-only">Profile type</legend>
          <p className="text-sm text-muted-foreground">
            What kind of non-employee is this? The choice determines which fields are
            collected and which approval workflow runs.
          </p>

          <div className="space-y-3">
            {profileTypes.map((type) => (
              <label
                key={type.id}
                className={[
                  'flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors',
                  profileTypeId === type.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-accent',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="profileTypeId"
                  value={type.id}
                  checked={profileTypeId === type.id}
                  onChange={() => setProfileTypeId(type.id)}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <div className="font-medium">{type.name}</div>
                  {type.description && (
                    <div className="text-sm text-muted-foreground">{type.description}</div>
                  )}
                </div>
              </label>
            ))}
          </div>

          {/*
            Showing the workflow before submission is the honest move: the
            sponsor learns what they are about to trigger while they can still
            change their mind.
          */}
          {workflow && (
            <div className="flex gap-3 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm">
              <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <div className="font-medium">This starts: {workflow.name}</div>
                {workflow.description && (
                  <div className="text-muted-foreground">{workflow.description}</div>
                )}
              </div>
            </div>
          )}
        </fieldset>

        {/* Step 2 — the person */}
        <fieldset hidden={step !== 1} className="space-y-4">
          <legend className="sr-only">Person details</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" name="firstName" required error={issuesByPath.get('firstName')} />
            <Field label="Last name" name="lastName" required error={issuesByPath.get('lastName')} />
          </div>
          <Field
            label="Work email"
            name="email"
            type="email"
            required
            error={issuesByPath.get('email')}
            help="Used as the unique identifier downstream, including in SCIM."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Job title" name="jobTitle" />
            <Field label="Department" name="department" />
          </div>
          <Field label="Location" name="location" />
        </fieldset>

        {/* Step 3 — the engagement */}
        <fieldset hidden={step !== 2} className="space-y-4">
          <legend className="sr-only">Engagement</legend>

          <div>
            <label htmlFor="type" className="label mb-1.5">
              Engagement type
            </label>
            <select id="type" name="type" className="input" defaultValue="CONTRACTOR">
              <option value="CONTRACTOR">Contractor</option>
              <option value="VENDOR">Vendor staff</option>
              <option value="VOLUNTEER">Volunteer</option>
              <option value="INTERN">Intern</option>
              <option value="SERVICE">Service account</option>
            </select>
          </div>

          <div>
            <label htmlFor="vendorCompanyId" className="label mb-1.5">
              Vendor company
            </label>
            <select id="vendorCompanyId" name="vendorCompanyId" className="input" defaultValue="">
              <option value="">None — engaged directly</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sponsorUserId" className="label mb-1.5">
              Internal sponsor
            </label>
            <select
              id="sponsorUserId"
              name="sponsorUserId"
              className="input"
              defaultValue={defaultSponsorId}
            >
              {sponsors.map((sponsor) => (
                <option key={sponsor.id} value={sponsor.id}>
                  {sponsor.name} ({sponsor.email})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              The sponsor approves this person and owns them for the life of the engagement.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" name="startDate" type="date" error={issuesByPath.get('startDate')} />
            <Field
              label="End date"
              name="endDate"
              type="date"
              error={issuesByPath.get('endDate')}
              help="Access lapses automatically on this date."
            />
          </div>

          <div>
            <label htmlFor="riskTier" className="label mb-1.5">
              Risk tier
            </label>
            <select id="riskTier" name="riskTier" className="input" defaultValue="LOW">
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Higher tiers may add screening steps to the approval workflow.
            </p>
          </div>
        </fieldset>

        {/* Step 4 — configured attributes */}
        <fieldset hidden={step !== 3} className="space-y-4">
          <legend className="sr-only">Additional details</legend>
          {selectedType && selectedType.attributes.length > 0 ? (
            selectedType.attributes.map((definition) => (
              <div key={definition.id}>
                <AttributeField definition={definition} />
                {issuesByPath.get(definition.key) && (
                  <p className="mt-1 text-xs text-destructive">
                    {issuesByPath.get(definition.key)}
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              This profile type has no additional fields configured.
            </p>
          )}
        </fieldset>

        {/* Step 5 — review */}
        <fieldset hidden={step !== 4} className="space-y-4">
          <legend className="sr-only">Review</legend>
          <p className="text-sm text-muted-foreground">
            The record is created as a draft. Submitting it for approval starts
            {workflow ? ` "${workflow.name}"` : ' the configured workflow'}.
          </p>
          <div className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm">
            <div className="font-medium">{selectedType?.name}</div>
            {workflow && (
              <div className="mt-1 text-muted-foreground">Workflow: {workflow.name}</div>
            )}
          </div>
        </fieldset>

        <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(s - 1, 0))}
            disabled={step === 0}
            className="btn-secondary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(s + 1, STEPS.length - 1))}
              className="btn-primary"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="submit" disabled={pending} className="btn-primary">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? 'Creating…' : 'Create record'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required = false,
  help,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  help?: string;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="label mb-1.5">
        {label}
        {required && (
          <span className="ml-1 text-destructive" aria-hidden>
            *
          </span>
        )}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={help ? `${name}-help` : undefined}
        className="input"
      />
      {help && (
        <p id={`${name}-help`} className="mt-1 text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
