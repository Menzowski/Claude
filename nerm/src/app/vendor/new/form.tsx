'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AttributeDefinition, ProfileType } from '@prisma/client';
import { AlertCircle, Loader2 } from 'lucide-react';
import { createPersonAction, type ActionResult } from '@/app/people/actions';
import { AttributeField } from '@/components/attribute-field';

type ProfileTypeWithAttributes = ProfileType & { attributes: AttributeDefinition[] };

/**
 * The vendor-side submission form. Deliberately shorter than the internal
 * wizard: no sponsor picker, no risk tier, no vendor selector. Those are
 * decided by the client, and the server derives them from the signed-in
 * administrator's own scope rather than from anything posted here.
 */
export function VendorSubmitForm({
  profileTypes,
}: {
  profileTypes: ProfileTypeWithAttributes[];
}) {
  const router = useRouter();
  const [profileTypeId, setProfileTypeId] = useState(profileTypes[0]?.id ?? '');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await createPersonAction(previous, formData);
      if (result.ok) router.push('/vendor?submitted=1');
      return result;
    },
    null,
  );

  const selected = profileTypes.find((type) => type.id === profileTypeId);

  return (
    <form action={formAction} className="mt-6 space-y-6">
      {state && !state.ok && (
        <div
          role="alert"
          className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
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

      <div className="card space-y-4 p-6">
        <div>
          <label htmlFor="profileTypeId" className="label mb-1.5">
            Worker type
          </label>
          <select
            id="profileTypeId"
            name="profileTypeId"
            className="input"
            value={profileTypeId}
            onChange={(event) => setProfileTypeId(event.target.value)}
            required
          >
            {profileTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" required />
          <Field label="Last name" name="lastName" required />
        </div>

        <Field label="Work email" name="email" type="email" required />
        <Field label="Job title" name="jobTitle" />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" name="startDate" type="date" />
          <Field label="End date" name="endDate" type="date" />
        </div>

        {/* Engagement type is fixed for vendor submissions. */}
        <input type="hidden" name="type" value="VENDOR" />

        {selected && selected.attributes.length > 0 && (
          <div className="space-y-4 border-t border-border pt-4">
            {selected.attributes.map((definition) => (
              <AttributeField key={definition.id} definition={definition} />
            ))}
          </div>
        )}
      </div>

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? 'Submitting…' : 'Submit for approval'}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
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
      <input id={name} name={name} type={type} required={required} className="input" />
    </div>
  );
}
