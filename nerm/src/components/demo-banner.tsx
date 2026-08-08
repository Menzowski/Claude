import { AlertTriangle } from 'lucide-react';
import { demoModeEnabled } from '@/lib/env';

/**
 * Renders nothing unless demo mode is on.
 *
 * When it is on, this is deliberately loud and cannot be dismissed. Someone
 * arriving at a shared link needs to understand, without reading any
 * documentation, that the sign-in on this deployment is a shared password and
 * that real personal data does not belong here. A banner people can close is a
 * banner people close once and never think about again.
 */
export function DemoBanner() {
  if (!demoModeEnabled) return null;

  return (
    <div
      role="alert"
      className="border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-amber-900 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <p>
          <span className="font-semibold">Demo mode.</span> Sign-in uses a shared password
          instead of single sign-on — this deployment is not secure. Do not enter real
          personal data.
        </p>
      </div>
    </div>
  );
}
