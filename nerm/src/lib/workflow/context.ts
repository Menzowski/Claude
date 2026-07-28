import type { Person } from '@prisma/client';

/**
 * The snapshot a workflow instance evaluates its conditions against.
 *
 * Snapshotting matters: an instance that started when someone was HIGH risk
 * should keep taking the HIGH-risk path even if their risk tier is edited
 * mid-flight. Re-reading live data would make the stage path depend on when
 * you happened to look at it.
 */
export type WorkflowContext = {
  person: {
    id: string;
    type: string;
    lifecycleState: string;
    riskTier: string;
    email: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    department: string | null;
    location: string | null;
    startDate: string | null;
    endDate: string | null;
    /** Engagement length in days, or null when either date is unset. */
    durationDays: number | null;
    hasVendor: boolean;
    vendorCompanyId: string | null;
    hasSponsor: boolean;
  };
  /** Custom attribute values, keyed by attribute definition key. */
  attributes: Record<string, string | number | boolean | null>;
};

type PersonForContext = Pick<
  Person,
  | 'id'
  | 'type'
  | 'lifecycleState'
  | 'riskTier'
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'jobTitle'
  | 'department'
  | 'location'
  | 'startDate'
  | 'endDate'
  | 'vendorCompanyId'
  | 'sponsorUserId'
>;

export function buildContext(
  person: PersonForContext,
  attributes: Record<string, string | number | boolean | null> = {},
): WorkflowContext {
  const durationDays =
    person.startDate && person.endDate
      ? Math.round(
          (person.endDate.getTime() - person.startDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : null;

  return {
    person: {
      id: person.id,
      type: person.type,
      lifecycleState: person.lifecycleState,
      riskTier: person.riskTier,
      email: person.email,
      firstName: person.firstName,
      lastName: person.lastName,
      jobTitle: person.jobTitle,
      department: person.department,
      location: person.location,
      startDate: person.startDate?.toISOString() ?? null,
      endDate: person.endDate?.toISOString() ?? null,
      durationDays,
      hasVendor: person.vendorCompanyId !== null,
      vendorCompanyId: person.vendorCompanyId,
      hasSponsor: person.sponsorUserId !== null,
    },
    attributes,
  };
}
