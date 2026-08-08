import { LifecycleState } from '@prisma/client';

/**
 * The lifecycle of a non-employee, expressed as an explicit state machine
 * rather than a free-text status column.
 *
 * Every transition in the product goes through `assertTransition` or
 * `canTransition`. Adding a state without adding its edges here makes it
 * unreachable, which is the intended failure mode: an unreachable state is a
 * visible bug, a silently-permitted transition is a compliance incident.
 */

export type Transition = {
  from: LifecycleState;
  to: LifecycleState;
  /** Dotted name recorded in the audit log. */
  action: string;
  /** Human-readable label used in the UI. */
  label: string;
  /**
   * Whether this edge may be taken by a person acting in the UI. System-only
   * edges (expiry sweeps, workflow completion) are excluded from action menus.
   */
  manual: boolean;
};

const TRANSITIONS: readonly Transition[] = [
  // Submission
  { from: 'DRAFT', to: 'PENDING_APPROVAL', action: 'person.submitted', label: 'Submit for approval', manual: true },
  { from: 'DRAFT', to: 'ARCHIVED', action: 'person.discarded', label: 'Discard draft', manual: true },

  // Approval
  { from: 'PENDING_APPROVAL', to: 'APPROVED', action: 'person.approved', label: 'Approve', manual: true },
  { from: 'PENDING_APPROVAL', to: 'REJECTED', action: 'person.rejected', label: 'Reject', manual: true },
  { from: 'PENDING_APPROVAL', to: 'DRAFT', action: 'person.returned', label: 'Return for changes', manual: true },

  // Activation — normally driven by a workflow `transition` stage.
  { from: 'APPROVED', to: 'ACTIVE', action: 'person.activated', label: 'Activate', manual: true },

  // Expiry
  { from: 'ACTIVE', to: 'EXPIRING', action: 'person.expiring', label: 'Flag as expiring', manual: false },
  { from: 'EXPIRING', to: 'ACTIVE', action: 'person.extended', label: 'Extend end date', manual: true },
  { from: 'EXPIRING', to: 'INACTIVE', action: 'person.expired', label: 'Deactivate', manual: false },
  { from: 'ACTIVE', to: 'INACTIVE', action: 'person.deactivated', label: 'Deactivate', manual: true },

  // Suspension
  { from: 'ACTIVE', to: 'SUSPENDED', action: 'person.suspended', label: 'Suspend', manual: true },
  { from: 'EXPIRING', to: 'SUSPENDED', action: 'person.suspended', label: 'Suspend', manual: true },
  { from: 'SUSPENDED', to: 'ACTIVE', action: 'person.reinstated', label: 'Reinstate', manual: true },
  { from: 'SUSPENDED', to: 'INACTIVE', action: 'person.deactivated', label: 'Deactivate', manual: true },

  // Rehire and archival
  { from: 'INACTIVE', to: 'PENDING_APPROVAL', action: 'person.rehire_requested', label: 'Request rehire', manual: true },
  { from: 'INACTIVE', to: 'ARCHIVED', action: 'person.archived', label: 'Archive', manual: true },
  { from: 'REJECTED', to: 'DRAFT', action: 'person.reopened', label: 'Reopen', manual: true },
  { from: 'REJECTED', to: 'ARCHIVED', action: 'person.archived', label: 'Archive', manual: true },
];

/** States in which the person is considered to hold live access. */
export const ACTIVE_STATES: readonly LifecycleState[] = ['ACTIVE', 'EXPIRING'];

/** States excluded from SCIM aggregation and default listings. */
export const TERMINAL_STATES: readonly LifecycleState[] = ['ARCHIVED'];

/** SCIM `active` is derived from lifecycle state, never stored separately. */
export function isActiveState(state: LifecycleState): boolean {
  return ACTIVE_STATES.includes(state);
}

export function findTransition(
  from: LifecycleState,
  to: LifecycleState,
): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return findTransition(from, to) !== undefined;
}

/** Every transition available from a state; `manualOnly` filters to UI actions. */
export function transitionsFrom(
  from: LifecycleState,
  manualOnly = false,
): Transition[] {
  return TRANSITIONS.filter((t) => t.from === from && (!manualOnly || t.manual));
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: LifecycleState,
    readonly to: LifecycleState,
  ) {
    super(`Illegal lifecycle transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

/** Throws unless the edge exists. Returns the edge so callers get its action name. */
export function assertTransition(
  from: LifecycleState,
  to: LifecycleState,
): Transition {
  const transition = findTransition(from, to);
  if (!transition) throw new IllegalTransitionError(from, to);
  return transition;
}

/**
 * The state a person should be in based on dates alone, ignoring approvals.
 * Used by the nightly expiry sweep; returns null when no change is due.
 */
export function dueStateForDates(
  current: LifecycleState,
  endDate: Date | null,
  now: Date,
  warningDays: number,
): LifecycleState | null {
  if (!endDate) return null;

  if (current === 'ACTIVE' || current === 'EXPIRING') {
    if (endDate <= now) return 'INACTIVE';

    const warnAt = new Date(endDate);
    warnAt.setDate(warnAt.getDate() - warningDays);
    if (now >= warnAt && current === 'ACTIVE') return 'EXPIRING';
  }

  return null;
}
