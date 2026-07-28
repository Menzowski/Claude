import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getActiveDefinition, getVersion, validateDefinition } from '@/lib/workflow/definitions';
import { buildContext } from '@/lib/workflow/context';
import { simulate } from '@/lib/workflow/engine';
import { authorize, jsonError, toErrorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ key: string }> };

/**
 * POST /api/v1/workflows/{key}/simulate — dry-run a definition.
 *
 * Body may contain:
 *   { personId }              simulate against a real person
 *   { person: {...} }         simulate against a hypothetical profile
 *   { version }               pin a version; defaults to the active one
 *   { definition: {...} }     simulate an unsaved draft
 *
 * Being able to answer "what will this configuration do" before publishing is
 * what separates a configurable workflow from a guessable one.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorize(request, { scope: 'api:workflows' });
  if ('response' in authorized) return authorized.response;

  try {
    const { key } = await params;
    const organizationId = authorized.actor.organizationId;
    const body = (await request.json().catch(() => ({}))) as {
      personId?: string;
      person?: Record<string, unknown>;
      version?: number;
      definition?: unknown;
    };

    // Resolve the definition: an inline draft, a pinned version, or the active one.
    let definitionInput: unknown;
    let versionLabel: string;

    if (body.definition) {
      definitionInput = body.definition;
      versionLabel = 'draft (unsaved)';
    } else if (body.version !== undefined) {
      const record = await getVersion(organizationId, key, body.version);
      if (!record) return jsonError(404, `No version ${body.version} of "${key}"`);
      definitionInput = record.definition;
      versionLabel = `v${record.version}`;
    } else {
      const record = await getActiveDefinition(organizationId, key);
      if (!record) return jsonError(404, `No active version of "${key}"`);
      definitionInput = record.definition;
      versionLabel = `v${record.version} (active)`;
    }

    const validation = validateDefinition(definitionInput);
    if (!validation.valid) {
      return NextResponse.json(
        { valid: false, errors: validation.errors },
        { status: 422 },
      );
    }

    // Build the context to simulate against.
    let context;
    let subject: string;

    if (body.personId) {
      const person = await prisma.person.findFirst({
        where: { id: body.personId, organizationId },
        include: { attributes: { include: { definition: { select: { key: true } } } } },
      });
      if (!person) return jsonError(404, `No person with id "${body.personId}"`);

      const attributes = Object.fromEntries(
        person.attributes.map((v) => [
          v.definition.key,
          v.stringValue ?? v.numberValue ?? v.boolValue ?? v.dateValue?.toISOString() ?? null,
        ]),
      );
      context = buildContext(person, attributes);
      subject = `${person.firstName} ${person.lastName}`;
    } else {
      const sample = (body.person ?? {}) as Record<string, unknown>;
      context = buildContext(
        {
          id: 'simulated',
          type: (sample.type as never) ?? 'CONTRACTOR',
          lifecycleState: (sample.lifecycleState as never) ?? 'DRAFT',
          riskTier: (sample.riskTier as never) ?? 'LOW',
          email: String(sample.email ?? 'simulated@example.com'),
          firstName: String(sample.firstName ?? 'Simulated'),
          lastName: String(sample.lastName ?? 'Person'),
          jobTitle: (sample.jobTitle as string) ?? null,
          department: (sample.department as string) ?? null,
          location: (sample.location as string) ?? null,
          startDate: sample.startDate ? new Date(String(sample.startDate)) : null,
          endDate: sample.endDate ? new Date(String(sample.endDate)) : null,
          vendorCompanyId: (sample.vendorCompanyId as string) ?? null,
          sponsorUserId: (sample.sponsorUserId as string) ?? null,
        },
        (sample.attributes as Record<string, string | number | boolean | null>) ?? {},
      );
      subject = 'hypothetical profile';
    }

    const result = simulate(validation.definition, context);

    return NextResponse.json({
      key,
      version: versionLabel,
      subject,
      triggered: result.triggered,
      triggerReason: result.triggerReason,
      stages: result.stages,
      path: result.stages.filter((s) => s.included).map((s) => s.id),
      warnings: validation.warnings,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
