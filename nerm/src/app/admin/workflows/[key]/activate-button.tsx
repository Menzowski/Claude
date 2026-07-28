'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/** Promote a published version to be the one new instances start on. */
export function ActivateButton({
  workflowKey,
  version,
}: {
  workflowKey: string;
  version: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function activate() {
    setPending(true);
    await fetch(`/api/v1/workflows/${encodeURIComponent(workflowKey)}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    });
    setPending(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={activate}
      disabled={pending}
      className="btn-secondary shrink-0 px-3 py-1 text-xs"
    >
      {pending && <Loader2 className="h-3 w-3 animate-spin" />}
      Activate
    </button>
  );
}
