import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { runExpirySweep } from '@/lib/jobs/expiry';
import { sweepOverdueTasks } from '@/lib/workflow/engine';
import { jsonError, toErrorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * Scheduled job trigger, for cron, a Kubernetes CronJob, or a platform
 * scheduler.
 *
 *   POST /api/v1/jobs/expiry   move people past their end date out of ACTIVE
 *   POST /api/v1/jobs/sla      escalate or auto-approve overdue tasks
 *
 * Guarded by a shared secret rather than a user session, because there is no
 * user. The comparison is constant-time so the header cannot be discovered a
 * byte at a time.
 */
const JOBS = ['expiry', 'sla'] as const;
type Job = (typeof JOBS)[number];

function authorized(request: Request): boolean {
  const secret = env.JOB_TRIGGER_SECRET;
  if (!secret) return false;

  const provided = request.headers.get('x-job-secret') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(request)) return jsonError(401, 'Invalid or missing job secret');

  const { job } = await params;
  if (!JOBS.includes(job as Job)) return jsonError(404, `Unknown job "${job}"`);

  try {
    const started = Date.now();
    const result =
      job === 'expiry' ? await runExpirySweep() : await sweepOverdueTasks();

    return NextResponse.json({
      job,
      ...result,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
