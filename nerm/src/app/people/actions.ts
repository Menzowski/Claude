'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { LifecycleState, PersonType, RiskTier } from '@prisma/client';
import { requireActor } from '@/lib/auth/actor';
import {
  assert,
  canCreatePerson,
  canWritePerson,
  vendorScopes,
  isVendorOnly,
} from '@/lib/authz/scope';
import { findProfileType, findWritablePerson } from '@/lib/queries/person-write';
import { getVendorOwner } from '@/lib/queries/vendors';
import { createPerson, ValidationError, type AttributeInput } from '@/lib/domain/person';
import { applyTransition } from '@/lib/domain/transition';
import { canTransition } from '@/lib/domain/lifecycle';
import { startWorkflow } from '@/lib/workflow/engine';

export type ActionResult =
  | { ok: true; personId?: string }
  | { ok: false; message: string; issues?: { path: string; message: string }[] };

/**
 * Create a person from the onboarding wizard.
 *
 * Vendor administrators may only create against their own vendor, and the
 * vendor is taken from their role assignment rather than from the form — a
 * hidden field is not an authorization boundary.
 */
export async function createPersonAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();

  const profileTypeId = String(formData.get('profileTypeId') ?? '');
  if (!profileTypeId) return { ok: false, message: 'Choose a profile type' };

  const profileType = await findProfileType(actor, profileTypeId);
  if (!profileType) return { ok: false, message: 'Unknown profile type' };

  const vendorOnly = isVendorOnly(actor);
  const scopedVendors = vendorScopes(actor);

  const vendorCompanyId = vendorOnly
    ? (scopedVendors[0] ?? null)
    : (String(formData.get('vendorCompanyId') ?? '') || null);

  if (!canCreatePerson(actor, vendorCompanyId)) {
    return { ok: false, message: 'You are not permitted to create this record' };
  }

  // A vendor administrator's submissions are always sponsored by the vendor's
  // internal owner — they cannot nominate an arbitrary internal employee.
  let sponsorUserId: string | null;
  if (vendorOnly) {
    sponsorUserId = vendorCompanyId ? await getVendorOwner(vendorCompanyId) : null;
  } else {
    sponsorUserId = String(formData.get('sponsorUserId') ?? '') || actor.userId;
  }

  const attributes: AttributeInput = {};
  for (const definition of profileType.attributes) {
    // A vendor administrator can only set attributes marked vendor-editable.
    if (vendorOnly && !definition.vendorEditable) continue;

    const field = `attr:${definition.key}`;
    if (definition.kind === 'BOOLEAN') {
      attributes[definition.key] = formData.get(field) === 'on';
    } else if (formData.has(field)) {
      const value = String(formData.get(field) ?? '').trim();
      attributes[definition.key] = value === '' ? null : value;
    }
  }

  const startDate = parseDate(formData.get('startDate'));
  const endDate = parseDate(formData.get('endDate'));

  if (startDate && endDate && endDate < startDate) {
    return {
      ok: false,
      message: 'The end date cannot be before the start date',
      issues: [{ path: 'endDate', message: 'Must be on or after the start date' }],
    };
  }

  try {
    const person = await createPerson(
      {
        organizationId: actor.organizationId,
        profileTypeId,
        type: (String(formData.get('type') ?? 'CONTRACTOR') as PersonType) || 'CONTRACTOR',
        firstName: String(formData.get('firstName') ?? '').trim(),
        lastName: String(formData.get('lastName') ?? '').trim(),
        email: String(formData.get('email') ?? '').trim(),
        jobTitle: String(formData.get('jobTitle') ?? '').trim() || null,
        department: String(formData.get('department') ?? '').trim() || null,
        location: String(formData.get('location') ?? '').trim() || null,
        riskTier: vendorOnly
          ? 'LOW'
          : ((String(formData.get('riskTier') ?? 'LOW') as RiskTier) || 'LOW'),
        startDate,
        endDate,
        sponsorUserId,
        vendorCompanyId,
        attributes,
      },
      { kind: 'USER', id: actor.userId, label: actor.email },
    );

    revalidatePath('/people');
    revalidatePath('/');
    return { ok: true, personId: person.id };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, message: error.message, issues: error.issues };
    }
    console.error('Failed to create person', error);
    return { ok: false, message: 'Could not create this record. Please try again.' };
  }
}

/** Move a person to a new lifecycle state from the person detail page. */
export async function transitionPersonAction(formData: FormData): Promise<void> {
  const actor = await requireActor();

  const personId = String(formData.get('personId') ?? '');
  const to = String(formData.get('to') ?? '') as LifecycleState;
  const reason = String(formData.get('reason') ?? '').trim() || undefined;

  const person = await findWritablePerson(actor, personId);
  if (!person) redirect('/people');
  assert(canWritePerson(actor, person), 'You cannot change this record');

  if (!canTransition(person.lifecycleState, to)) {
    // The UI only offers legal transitions; reaching here means a stale page.
    redirect(`/people/${personId}?error=illegal_transition`);
  }

  await applyTransition({
    personId,
    to,
    actor: { kind: 'USER', id: actor.userId, label: actor.email },
    reason,
  });

  // Submitting for approval is what kicks off the configured workflow.
  if (to === 'PENDING_APPROVAL') {
    await startWorkflow({
      personId,
      event: 'person.submitted',
      actor: { kind: 'USER', id: actor.userId, label: actor.email },
    });
  }

  revalidatePath(`/people/${personId}`);
  revalidatePath('/people');
  redirect(`/people/${personId}`);
}

function parseDate(value: FormDataEntryValue | null): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
