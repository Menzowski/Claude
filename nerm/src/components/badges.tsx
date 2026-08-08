import type { LifecycleState, RiskTier, TaskStatus } from '@prisma/client';
import { LIFECYCLE_STYLES, RISK_STYLES, TASK_STATUS_STYLES, cn } from '@/lib/ui';

export function LifecycleBadge({ state }: { state: LifecycleState }) {
  const style = LIFECYCLE_STYLES[state];
  return <span className={cn('badge', style.className)}>{style.label}</span>;
}

export function RiskBadge({ tier }: { tier: RiskTier }) {
  const style = RISK_STYLES[tier];
  return <span className={cn('badge', style.className)}>{style.label} risk</span>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const style = TASK_STATUS_STYLES[status];
  return <span className={cn('badge', style.className)}>{style.label}</span>;
}
