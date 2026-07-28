import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { LifecycleState, RiskTier, TaskStatus } from '@prisma/client';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Lifecycle state presentation. Colour carries meaning here: green for live
 * access, amber for time-limited attention, red for blocked, grey for over.
 */
export const LIFECYCLE_STYLES: Record<LifecycleState, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  PENDING_APPROVAL: {
    label: 'Pending approval',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  APPROVED: { label: 'Approved', className: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  ACTIVE: { label: 'Active', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  EXPIRING: { label: 'Expiring', className: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
  SUSPENDED: { label: 'Suspended', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  INACTIVE: { label: 'Inactive', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  REJECTED: { label: 'Rejected', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  ARCHIVED: { label: 'Archived', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500' },
};

export const RISK_STYLES: Record<RiskTier, { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  MEDIUM: { label: 'Medium', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300' },
  HIGH: { label: 'High', className: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
  CRITICAL: { label: 'Critical', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
};

export const TASK_STATUS_STYLES: Record<TaskStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  APPROVED: { label: 'Approved', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  REJECTED: { label: 'Rejected', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  COMPLETED: { label: 'Completed', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  SKIPPED: { label: 'Skipped', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  ESCALATED: { label: 'Escalated', className: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
  CANCELLED: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500' },
};

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const value = typeof date === 'string' ? new Date(date) : date;
  return value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const value = typeof date === 'string' ? new Date(date) : date;
  return value.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "in 12 days" / "8 days ago" — the framing sponsors actually think in. */
export function relativeDays(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const value = typeof date === 'string' ? new Date(date) : date;
  const days = Math.round((value.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}
