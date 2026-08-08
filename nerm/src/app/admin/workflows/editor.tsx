'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Play, Save } from 'lucide-react';

type Issue = { path: string; message: string };

type SimulationStage = {
  id: string;
  type: string;
  name: string;
  included: boolean;
  reason: string;
};

type Simulation = {
  triggered: boolean;
  triggerReason: string;
  stages: SimulationStage[];
  path: string[];
};

/**
 * The workflow editor.
 *
 * It is a JSON editor with validation and a simulator rather than a canvas,
 * and it talks to exactly the endpoints the REST API documents — so what an
 * administrator does here and what a CI job does with Postman are the same
 * operations against the same validation. The two authoring paths cannot drift
 * because there is only one of them.
 */
export function WorkflowEditor({
  workflowKey,
  initialDefinition,
  latestVersion,
}: {
  workflowKey: string | null;
  initialDefinition: string;
  latestVersion?: number;
}) {
  const router = useRouter();
  const [json, setJson] = useState(initialDefinition);
  const [busy, setBusy] = useState<'validate' | 'simulate' | 'save' | null>(null);
  const [errors, setErrors] = useState<Issue[]>([]);
  const [warnings, setWarnings] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);

  function parseJson(): unknown | null {
    try {
      return JSON.parse(json);
    } catch (error) {
      setErrors([
        {
          path: '(document)',
          message: error instanceof Error ? error.message : 'Invalid JSON',
        },
      ]);
      setWarnings([]);
      setMessage(null);
      return null;
    }
  }

  function reset() {
    setErrors([]);
    setWarnings([]);
    setMessage(null);
  }

  async function validate() {
    reset();
    const parsed = parseJson();
    if (parsed === null) return;

    setBusy('validate');
    const response = await fetch('/api/v1/workflows/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
    const body = await response.json();
    setBusy(null);

    if (body.valid) {
      setWarnings(body.warnings ?? []);
      setMessage('This definition is valid.');
    } else {
      setErrors(body.errors ?? [{ path: '(document)', message: 'Validation failed' }]);
    }
  }

  async function runSimulation() {
    reset();
    setSimulation(null);
    const parsed = parseJson();
    if (parsed === null) return;

    setBusy('simulate');
    const key = workflowKey ?? (parsed as { key?: string }).key ?? 'draft';
    const response = await fetch(`/api/v1/workflows/${encodeURIComponent(key)}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        definition: parsed,
        // A representative high-risk, long engagement, so conditional stages
        // show up rather than being silently skipped in the preview.
        person: {
          type: 'CONTRACTOR',
          riskTier: 'HIGH',
          department: 'Engineering',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString(),
        },
      }),
    });
    const body = await response.json();
    setBusy(null);

    if (response.ok) {
      setSimulation(body);
    } else {
      setErrors(body.errors ?? [{ path: '(document)', message: body.error?.message ?? 'Simulation failed' }]);
    }
  }

  async function save() {
    reset();
    const parsed = parseJson();
    if (parsed === null) return;

    setBusy('save');
    const key = workflowKey ?? (parsed as { key?: string }).key;
    if (!key) {
      setBusy(null);
      setErrors([{ path: 'key', message: 'A workflow key is required' }]);
      return;
    }

    const response = await fetch(
      workflowKey ? `/api/v1/workflows/${encodeURIComponent(key)}` : '/api/v1/workflows',
      {
        method: workflowKey ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      },
    );
    const body = await response.json();
    setBusy(null);

    if (response.ok) {
      setMessage(
        `Published version ${body.version}.${
          body.active ? ' It is now active.' : ' Activate it when you are ready.'
        }`,
      );
      router.refresh();
      if (!workflowKey) router.push(`/admin/workflows/${key}`);
    } else {
      setErrors(
        body.error?.details ?? [
          { path: '(document)', message: body.error?.message ?? 'Could not publish' },
        ],
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            Definition
            {latestVersion !== undefined && (
              <span className="ml-2 font-normal text-muted-foreground">
                editing from v{latestVersion}
              </span>
            )}
          </h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={validate} disabled={busy !== null} className="btn-secondary">
              {busy === 'validate' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Validate
            </button>
            <button type="button" onClick={runSimulation} disabled={busy !== null} className="btn-secondary">
              {busy === 'simulate' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Simulate
            </button>
            <button type="button" onClick={save} disabled={busy !== null} className="btn-primary">
              {busy === 'save' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Publish version
            </button>
          </div>
        </div>

        <textarea
          value={json}
          onChange={(event) => setJson(event.target.value)}
          spellCheck={false}
          rows={28}
          aria-label="Workflow definition JSON"
          className="w-full resize-y border-0 bg-transparent p-4 font-mono text-xs leading-relaxed focus:outline-none"
        />
      </div>

      {errors.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" />
            {errors.length === 1 ? '1 problem' : `${errors.length} problems`}
          </div>
          <ul className="mt-2 space-y-1">
            {errors.map((issue, index) => (
              <li key={`${issue.path}-${index}`}>
                <span className="font-mono text-xs">{issue.path}</span> — {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <div className="font-medium">Worth checking</div>
          <ul className="mt-1 list-inside list-disc">
            {warnings.map((warning, index) => (
              <li key={index}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      {simulation && (
        <section className="card">
          <h2 className="border-b border-border px-5 py-4 text-sm font-semibold">
            Simulation — a high-risk contractor on a 400-day engagement
          </h2>
          <div className="px-5 py-4">
            <p className="text-sm text-muted-foreground">{simulation.triggerReason}</p>

            {simulation.triggered ? (
              <ol className="mt-4 space-y-2">
                {simulation.stages.map((stage) => (
                  <li
                    key={stage.id}
                    className={[
                      'flex items-start gap-3 rounded-md border px-3 py-2 text-sm',
                      stage.included
                        ? 'border-border bg-background'
                        : 'border-dashed border-border bg-muted/40 text-muted-foreground',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full',
                        stage.included ? 'bg-primary' : 'bg-muted-foreground/40',
                      ].join(' ')}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <div className="font-medium">
                        {stage.name}{' '}
                        <span className="font-mono text-xs font-normal text-muted-foreground">
                          {stage.type}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">{stage.reason}</div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm">
                This workflow would not start for that profile.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
