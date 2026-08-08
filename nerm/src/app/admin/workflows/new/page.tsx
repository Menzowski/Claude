import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '@/lib/auth/actor';
import { isAdmin } from '@/lib/authz/scope';
import { AppShell } from '@/components/app-shell';
import { WorkflowEditor } from '../editor';

export const dynamic = 'force-dynamic';

/** A starting point that already demonstrates conditions, SLAs and escalation. */
const TEMPLATE = JSON.stringify(
  {
    key: 'new-workflow',
    name: 'New workflow',
    description: 'Describe what this workflow is for.',
    trigger: {
      on: 'person.created',
      when: "person.type == 'CONTRACTOR'",
    },
    stages: [
      {
        id: 'sponsor-approval',
        name: 'Sponsor approval',
        type: 'approval',
        assignee: { kind: 'sponsor' },
        sla: 'P3D',
        onTimeout: 'escalate',
        escalateTo: { kind: 'role', role: 'IAM_ADMIN' },
        onReject: 'REJECTED',
      },
      {
        id: 'screening',
        name: 'Background screening',
        type: 'task',
        title: 'Complete background screening',
        assignee: { kind: 'role', role: 'IAM_ADMIN' },
        when: "person.riskTier in ['HIGH','CRITICAL']",
      },
      { id: 'approve', type: 'transition', to: 'APPROVED' },
      { id: 'activate', type: 'transition', to: 'ACTIVE' },
    ],
  },
  null,
  2,
);

export default async function NewWorkflowPage() {
  const actor = await currentActor();
  if (!actor) redirect('/signin');
  if (!isAdmin(actor)) redirect('/');

  return (
    <AppShell actor={actor}>
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link href="/admin/workflows" className="hover:underline">
          Workflows
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">New</span>
      </nav>

      <h1 className="text-2xl font-semibold tracking-tight">New workflow</h1>
      <p className="mb-8 mt-1 max-w-2xl text-sm text-muted-foreground">
        Edit the definition below, validate it, and simulate it against a sample profile before
        publishing. Version 1 is activated automatically.
      </p>

      <div className="max-w-4xl">
        <WorkflowEditor workflowKey={null} initialDefinition={TEMPLATE} />
      </div>
    </AppShell>
  );
}
