import { z } from 'zod';

/**
 * The workflow definition language.
 *
 * A definition is a JSON document. It is the single source of truth: the admin
 * UI renders this shape and writes it back, and the REST API accepts exactly
 * the same document. There is no second, UI-only representation to drift.
 */

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'Must be alphanumeric with - or _');

/** ISO 8601 duration, restricted to the days/hours form we actually support. */
const duration = z
  .string()
  .regex(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?)?$/, 'Expected an ISO 8601 duration like P3D or PT12H');

/** Who a task falls to. */
export const assigneeSchema = z.discriminatedUnion('kind', [
  /** The internal sponsor of the person the workflow is about. */
  z.object({ kind: z.literal('sponsor') }),
  /** The person themselves (used for document upload tasks). */
  z.object({ kind: z.literal('subject') }),
  /** The internal owner of the person's vendor company. */
  z.object({ kind: z.literal('vendorOwner') }),
  /** Anyone holding a role; the task appears in every holder's queue. */
  z.object({ kind: z.literal('role'), role: z.enum(['IAM_ADMIN', 'SPONSOR', 'AUDITOR']) }),
  /** A named user, by email. */
  z.object({ kind: z.literal('user'), email: z.string().email() }),
]);

export type Assignee = z.infer<typeof assigneeSchema>;

const baseStage = z.object({
  id: identifier,
  name: z.string().min(1).max(120).optional(),
  /**
   * Condition controlling whether this stage runs. Evaluated against the
   * instance context by the sandboxed evaluator in ./evaluator.ts.
   * Omitted means "always run".
   */
  when: z.string().max(500).optional(),
});

const slaFields = {
  sla: duration.optional(),
  onTimeout: z.enum(['escalate', 'autoApprove', 'nothing']).default('nothing'),
  escalateTo: assigneeSchema.optional(),
};

export const stageSchema = z.discriminatedUnion('type', [
  /** A human decision that can approve or reject the whole instance. */
  baseStage.extend({
    type: z.literal('approval'),
    assignee: assigneeSchema,
    /** What happens to the person when this stage is rejected. */
    onReject: z.enum(['REJECTED', 'DRAFT']).default('REJECTED'),
    ...slaFields,
  }),
  /** Required document upload. */
  baseStage.extend({
    type: z.literal('document'),
    assignee: assigneeSchema,
    requires: z.array(z.string().min(1).max(64)).min(1),
    ...slaFields,
  }),
  /** A checklist item someone must mark done. */
  baseStage.extend({
    type: z.literal('task'),
    assignee: assigneeSchema,
    title: z.string().min(1).max(200).optional(),
    ...slaFields,
  }),
  /** Move the person to a lifecycle state. Validated against the state machine. */
  baseStage.extend({
    type: z.literal('transition'),
    to: z.enum([
      'PENDING_APPROVAL',
      'APPROVED',
      'ACTIVE',
      'SUSPENDED',
      'INACTIVE',
      'REJECTED',
      'ARCHIVED',
    ]),
  }),
  /** Send a notification. Non-blocking. */
  baseStage.extend({
    type: z.literal('notify'),
    to: assigneeSchema,
    template: z.string().min(1).max(64),
  }),
]);

export type Stage = z.infer<typeof stageSchema>;
export type StageType = Stage['type'];

export const workflowDefinitionSchema = z
  .object({
    key: identifier,
    name: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
    trigger: z.object({
      on: z.enum(['person.created', 'person.submitted', 'person.expiring', 'manual']),
      when: z.string().max(500).optional(),
    }),
    stages: z.array(stageSchema).min(1).max(50),
  })
  .superRefine((def, ctx) => {
    const seen = new Set<string>();
    def.stages.forEach((stage, index) => {
      if (seen.has(stage.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages', index, 'id'],
          message: `Duplicate stage id "${stage.id}"`,
        });
      }
      seen.add(stage.id);

      if ('onTimeout' in stage && stage.onTimeout === 'escalate' && !stage.escalateTo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages', index, 'escalateTo'],
          message: 'escalateTo is required when onTimeout is "escalate"',
        });
      }

      if ('sla' in stage && stage.onTimeout !== 'nothing' && !stage.sla) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages', index, 'sla'],
          message: 'sla is required when onTimeout is set',
        });
      }
    });
  });

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/** Flatten a Zod error into `{ path, message }` pairs the API and UI both use. */
export function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

/** Parse an ISO 8601 duration (days/hours) into milliseconds. */
export function durationToMs(iso: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?)?$/.exec(iso);
  if (!match) return 0;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  return (days * 24 + hours) * 60 * 60 * 1000;
}
