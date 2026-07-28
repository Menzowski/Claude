'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireActor } from '@/lib/auth/actor';
import { findDecidableTask } from '@/lib/queries/tasks';
import { decideTask, type TaskDecision } from '@/lib/workflow/engine';

/**
 * Decide a task.
 *
 * The task is re-read through `taskScope` rather than trusted from the form:
 * possessing a task id must not be the same thing as being allowed to decide it.
 */
export async function decideTaskAction(formData: FormData): Promise<void> {
  const actor = await requireActor();

  const taskId = String(formData.get('taskId') ?? '');
  const decision = String(formData.get('decision') ?? '') as TaskDecision;
  const comment = String(formData.get('comment') ?? '').trim() || undefined;

  if (!['APPROVED', 'REJECTED', 'COMPLETED'].includes(decision)) {
    redirect('/tasks?error=invalid_decision');
  }

  // Resolved through the actor's scope, which also enforces that an
  // administrator may act on any task in the queue while everyone else may act
  // only on tasks actually assigned to them.
  const { task, reason } = await findDecidableTask(actor, taskId);
  if (!task) redirect(`/tasks?error=${reason}`);

  await decideTask({
    taskId,
    decision,
    actor: { kind: 'USER', id: actor.userId, label: actor.email },
    comment,
  });

  revalidatePath('/tasks');
  revalidatePath('/');
  redirect('/tasks?decided=1');
}
