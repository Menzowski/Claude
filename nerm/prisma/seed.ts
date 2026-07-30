import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { authenticator } from 'otplib';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Seed a working organization: profile types with attribute schemas, two
 * workflows, vendors, users across all four roles, and a spread of people at
 * different lifecycle stages so every screen has something real to show.
 *
 * Idempotent — safe to re-run.
 */

const prisma = new PrismaClient();

const CONTRACTOR_ONBOARDING = {
  key: 'contractor-onboarding',
  name: 'Contractor onboarding',
  description:
    'Standard onboarding for contractors. High-risk engagements pick up an extra screening step.',
  trigger: {
    on: 'person.created',
    when: "person.type == 'CONTRACTOR' or person.type == 'VENDOR'",
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
      id: 'nda',
      name: 'Signed NDA',
      type: 'document',
      assignee: { kind: 'sponsor' },
      requires: ['NDA'],
      sla: 'P5D',
      onTimeout: 'escalate',
      escalateTo: { kind: 'role', role: 'IAM_ADMIN' },
    },
    {
      id: 'screening',
      name: 'Background screening',
      type: 'task',
      title: 'Complete background screening',
      assignee: { kind: 'role', role: 'IAM_ADMIN' },
      when: "person.riskTier in ['HIGH','CRITICAL']",
      sla: 'P10D',
      onTimeout: 'escalate',
      escalateTo: { kind: 'role', role: 'IAM_ADMIN' },
    },
    {
      id: 'long-engagement-review',
      name: 'Long engagement review',
      type: 'approval',
      assignee: { kind: 'role', role: 'IAM_ADMIN' },
      when: 'person.durationDays > 365',
      onReject: 'DRAFT',
    },
    { id: 'approve', type: 'transition', to: 'APPROVED' },
    { id: 'activate', type: 'transition', to: 'ACTIVE' },
    {
      id: 'welcome',
      name: 'Welcome notification',
      type: 'notify',
      to: { kind: 'sponsor' },
      template: 'contractor-activated',
    },
  ],
};

const VOLUNTEER_ONBOARDING = {
  key: 'volunteer-onboarding',
  name: 'Volunteer onboarding',
  description: 'Lightweight path for volunteers and interns — one approval, no screening.',
  trigger: {
    on: 'person.created',
    when: "person.type in ['VOLUNTEER','INTERN']",
  },
  stages: [
    {
      id: 'sponsor-approval',
      name: 'Sponsor approval',
      type: 'approval',
      assignee: { kind: 'sponsor' },
      sla: 'P5D',
      onTimeout: 'escalate',
      escalateTo: { kind: 'role', role: 'IAM_ADMIN' },
      onReject: 'REJECTED',
    },
    { id: 'approve', type: 'transition', to: 'APPROVED' },
    { id: 'activate', type: 'transition', to: 'ACTIVE' },
  ],
};

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Idempotent role assignment.
 *
 * Prisma cannot target a compound unique whose column is null, and Postgres
 * treats NULLs as distinct anyway — the migration adds NULLS NOT DISTINCT so
 * the database genuinely rejects duplicates, and this helper stays correct
 * either way.
 */
async function ensureRole(
  userId: string,
  role: 'IAM_ADMIN' | 'SPONSOR' | 'VENDOR_ADMIN' | 'AUDITOR',
  vendorCompanyId: string | null = null,
) {
  const existing = await prisma.roleAssignment.findFirst({
    where: { userId, role, vendorCompanyId },
  });
  if (existing) return existing;
  return prisma.roleAssignment.create({ data: { userId, role, vendorCompanyId } });
}

async function main() {
  console.log('Seeding…');

  const organization = await prisma.organization.upsert({
    where: { domain: 'example.com' },
    update: {},
    create: { name: 'Example Corporation', domain: 'example.com' },
  });

  // -------------------------------------------------------------------------
  // Users — emails match the Keycloak realm in docker/keycloak-realm.json
  // -------------------------------------------------------------------------
  const users = await Promise.all(
    [
      { email: 'admin.iam@example.com', name: 'Ada Admin', role: 'IAM_ADMIN' as const },
      { email: 'sam.sponsor@example.com', name: 'Sam Sponsor', role: 'SPONSOR' as const },
      { email: 'iris.auditor@example.com', name: 'Iris Auditor', role: 'AUDITOR' as const },
      { email: 'sofia.sponsor@example.com', name: 'Sofia Sponsor', role: 'SPONSOR' as const },
    ].map(async ({ email, name, role }) => {
      const user = await prisma.user.upsert({
        where: { organizationId_email: { organizationId: organization.id, email } },
        update: { name },
        create: { organizationId: organization.id, email, name, kind: 'INTERNAL' },
      });

      await ensureRole(user.id, role);

      return { ...user, role };
    }),
  );

  const admin = users.find((u) => u.role === 'IAM_ADMIN')!;
  const sponsor = users.find((u) => u.email === 'sam.sponsor@example.com')!;
  const sponsor2 = users.find((u) => u.email === 'sofia.sponsor@example.com')!;

  // -------------------------------------------------------------------------
  // Vendors
  // -------------------------------------------------------------------------
  const acme = await prisma.vendorCompany.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: 'Acme Consulting' } },
    update: {},
    create: {
      organizationId: organization.id,
      name: 'Acme Consulting',
      externalId: 'VEND-0001',
      status: 'ACTIVE',
      contractStart: daysFromNow(-400),
      contractEnd: daysFromNow(200),
      ownerUserId: sponsor.id,
    },
  });

  const northwind = await prisma.vendorCompany.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: 'Northwind Services' } },
    update: {},
    create: {
      organizationId: organization.id,
      name: 'Northwind Services',
      externalId: 'VEND-0002',
      status: 'ACTIVE',
      contractStart: daysFromNow(-100),
      contractEnd: daysFromNow(500),
      ownerUserId: sponsor2.id,
    },
  });

  // -------------------------------------------------------------------------
  // Vendor administrators — local accounts with password + TOTP.
  // Credentials are printed at the end for local sign-in.
  // -------------------------------------------------------------------------
  const vendorAdminPassword = 'Vendor!Passw0rd';
  const passwordHash = await hash(vendorAdminPassword);

  const vendorAdmins = await Promise.all(
    [
      { email: 'vic.admin@acme.example', name: 'Vic Acme', vendor: acme },
      { email: 'nina.admin@northwind.example', name: 'Nina Northwind', vendor: northwind },
    ].map(async ({ email, name, vendor }) => {
      const secret = authenticator.generateSecret();
      const user = await prisma.user.upsert({
        where: { organizationId_email: { organizationId: organization.id, email } },
        update: { name, passwordHash, totpSecret: secret, totpConfirmedAt: new Date() },
        create: {
          organizationId: organization.id,
          email,
          name,
          kind: 'EXTERNAL',
          passwordHash,
          totpSecret: secret,
          totpConfirmedAt: new Date(),
        },
      });

      await ensureRole(user.id, 'VENDOR_ADMIN', vendor.id);

      return { email, secret };
    }),
  );

  // -------------------------------------------------------------------------
  // Profile types and their attribute schemas
  // -------------------------------------------------------------------------
  const contractorType = await prisma.profileType.upsert({
    where: { organizationId_key: { organizationId: organization.id, key: 'contractor' } },
    update: { workflowKey: CONTRACTOR_ONBOARDING.key },
    create: {
      organizationId: organization.id,
      key: 'contractor',
      name: 'Contractor',
      description: 'External contractor or vendor staff member',
      workflowKey: CONTRACTOR_ONBOARDING.key,
    },
  });

  const volunteerType = await prisma.profileType.upsert({
    where: { organizationId_key: { organizationId: organization.id, key: 'volunteer' } },
    update: { workflowKey: VOLUNTEER_ONBOARDING.key },
    create: {
      organizationId: organization.id,
      key: 'volunteer',
      name: 'Volunteer / Intern',
      description: 'Unpaid or short-term participant',
      workflowKey: VOLUNTEER_ONBOARDING.key,
    },
  });

  const contractorAttributes = [
    {
      key: 'costCenter',
      label: 'Cost centre',
      kind: 'STRING' as const,
      required: true,
      sensitivity: 'INTERNAL' as const,
      order: 10,
      vendorVisible: true,
      vendorEditable: false,
    },
    {
      key: 'purchaseOrder',
      label: 'Purchase order',
      kind: 'STRING' as const,
      required: false,
      sensitivity: 'INTERNAL' as const,
      order: 20,
      vendorVisible: true,
      vendorEditable: true,
    },
    {
      key: 'workLocation',
      label: 'Work location',
      kind: 'SELECT' as const,
      required: true,
      sensitivity: 'PUBLIC' as const,
      order: 30,
      options: [
        { value: 'onsite', label: 'On site' },
        { value: 'remote', label: 'Remote' },
        { value: 'hybrid', label: 'Hybrid' },
      ],
      vendorVisible: true,
      vendorEditable: true,
    },
    {
      key: 'nationalId',
      label: 'National ID',
      kind: 'STRING' as const,
      required: false,
      sensitivity: 'SENSITIVE_PII' as const,
      order: 40,
      helpText: 'Masked for all but administrators and auditors.',
      vendorVisible: false,
      vendorEditable: false,
    },
    {
      key: 'personalEmail',
      label: 'Personal email',
      kind: 'EMAIL' as const,
      required: false,
      sensitivity: 'PII' as const,
      order: 50,
      vendorVisible: true,
      vendorEditable: true,
    },
    {
      key: 'needsBuildingAccess',
      label: 'Needs building access',
      kind: 'BOOLEAN' as const,
      required: false,
      sensitivity: 'INTERNAL' as const,
      order: 60,
      vendorVisible: true,
      vendorEditable: true,
    },
  ];

  for (const attribute of contractorAttributes) {
    await prisma.attributeDefinition.upsert({
      where: {
        profileTypeId_key: { profileTypeId: contractorType.id, key: attribute.key },
      },
      update: { ...attribute },
      create: { profileTypeId: contractorType.id, ...attribute },
    });
  }

  for (const attribute of [
    {
      key: 'programme',
      label: 'Programme',
      kind: 'STRING' as const,
      required: true,
      sensitivity: 'PUBLIC' as const,
      order: 10,
    },
    {
      key: 'supervisor',
      label: 'Supervisor',
      kind: 'STRING' as const,
      required: false,
      sensitivity: 'INTERNAL' as const,
      order: 20,
    },
  ]) {
    await prisma.attributeDefinition.upsert({
      where: { profileTypeId_key: { profileTypeId: volunteerType.id, key: attribute.key } },
      update: { ...attribute },
      create: { profileTypeId: volunteerType.id, ...attribute },
    });
  }

  // -------------------------------------------------------------------------
  // Workflow definitions
  // -------------------------------------------------------------------------
  for (const definition of [CONTRACTOR_ONBOARDING, VOLUNTEER_ONBOARDING]) {
    const existing = await prisma.workflowDefinition.findFirst({
      where: { organizationId: organization.id, key: definition.key, version: 1 },
    });

    if (!existing) {
      await prisma.workflowDefinition.create({
        data: {
          organizationId: organization.id,
          key: definition.key,
          version: 1,
          name: definition.name,
          description: definition.description,
          definition,
          active: true,
          createdBy: admin.id,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // People, spread across lifecycle states
  // -------------------------------------------------------------------------
  const people = [
    {
      firstName: 'Priya',
      lastName: 'Contractor',
      email: 'priya.contractor@acme.example',
      type: 'CONTRACTOR' as const,
      lifecycleState: 'ACTIVE' as const,
      riskTier: 'MEDIUM' as const,
      jobTitle: 'Senior Backend Engineer',
      department: 'Engineering',
      location: 'Amsterdam',
      vendorCompanyId: acme.id,
      sponsorUserId: sponsor.id,
      startDate: daysFromNow(-120),
      endDate: daysFromNow(180),
      attributes: { costCenter: 'CC-1001', workLocation: 'hybrid', needsBuildingAccess: true },
    },
    {
      firstName: 'Tom',
      lastName: 'Fieldwork',
      email: 'tom.fieldwork@acme.example',
      type: 'CONTRACTOR' as const,
      lifecycleState: 'EXPIRING' as const,
      riskTier: 'HIGH' as const,
      jobTitle: 'Site Engineer',
      department: 'Facilities',
      location: 'Rotterdam',
      vendorCompanyId: acme.id,
      sponsorUserId: sponsor.id,
      startDate: daysFromNow(-300),
      endDate: daysFromNow(12),
      attributes: { costCenter: 'CC-2002', workLocation: 'onsite', needsBuildingAccess: true },
    },
    {
      firstName: 'Lena',
      lastName: 'Northwind',
      email: 'lena@northwind.example',
      type: 'VENDOR' as const,
      lifecycleState: 'PENDING_APPROVAL' as const,
      riskTier: 'LOW' as const,
      jobTitle: 'Support Analyst',
      department: 'IT Operations',
      location: 'Utrecht',
      vendorCompanyId: northwind.id,
      sponsorUserId: sponsor2.id,
      startDate: daysFromNow(7),
      endDate: daysFromNow(200),
      attributes: { costCenter: 'CC-3003', workLocation: 'remote' },
    },
    {
      firstName: 'Kwame',
      lastName: 'Critical',
      email: 'kwame.critical@northwind.example',
      type: 'CONTRACTOR' as const,
      lifecycleState: 'PENDING_APPROVAL' as const,
      riskTier: 'CRITICAL' as const,
      jobTitle: 'Database Administrator',
      department: 'Platform',
      location: 'Amsterdam',
      vendorCompanyId: northwind.id,
      sponsorUserId: sponsor.id,
      startDate: daysFromNow(14),
      endDate: daysFromNow(600),
      attributes: { costCenter: 'CC-4004', workLocation: 'onsite', needsBuildingAccess: true },
    },
    {
      firstName: 'Mira',
      lastName: 'Volunteer',
      email: 'mira.volunteer@example.org',
      type: 'VOLUNTEER' as const,
      lifecycleState: 'ACTIVE' as const,
      riskTier: 'LOW' as const,
      jobTitle: 'Community Volunteer',
      department: 'Community',
      location: 'The Hague',
      vendorCompanyId: null,
      sponsorUserId: sponsor2.id,
      startDate: daysFromNow(-30),
      endDate: daysFromNow(60),
      profileType: volunteerType,
      attributes: { programme: 'Open Days 2026' },
    },
    {
      firstName: 'Otto',
      lastName: 'Offboarded',
      email: 'otto.offboarded@acme.example',
      type: 'CONTRACTOR' as const,
      lifecycleState: 'INACTIVE' as const,
      riskTier: 'LOW' as const,
      jobTitle: 'Frontend Developer',
      department: 'Engineering',
      location: 'Amsterdam',
      vendorCompanyId: acme.id,
      sponsorUserId: sponsor.id,
      startDate: daysFromNow(-500),
      endDate: daysFromNow(-30),
      attributes: { costCenter: 'CC-1001', workLocation: 'remote' },
    },
    {
      firstName: 'Dana',
      lastName: 'Draft',
      email: 'dana.draft@acme.example',
      type: 'CONTRACTOR' as const,
      lifecycleState: 'DRAFT' as const,
      riskTier: 'LOW' as const,
      jobTitle: 'QA Engineer',
      department: 'Engineering',
      location: 'Remote',
      vendorCompanyId: acme.id,
      sponsorUserId: sponsor.id,
      startDate: daysFromNow(30),
      endDate: daysFromNow(210),
      attributes: { costCenter: 'CC-1001', workLocation: 'remote' },
    },
  ];

  for (const entry of people) {
    const { attributes, profileType, ...core } = entry;
    const type = profileType ?? contractorType;

    const existing = await prisma.person.findFirst({
      where: { organizationId: organization.id, email: core.email },
    });
    if (existing) continue;

    const person = await prisma.person.create({
      data: { ...core, organizationId: organization.id, profileTypeId: type.id },
    });

    const definitions = await prisma.attributeDefinition.findMany({
      where: { profileTypeId: type.id },
    });

    for (const [key, value] of Object.entries(attributes ?? {})) {
      const definition = definitions.find((d) => d.key === key);
      if (!definition) continue;

      await prisma.attributeValue.create({
        data: {
          personId: person.id,
          definitionId: definition.id,
          stringValue: typeof value === 'string' ? value : null,
          numberValue: typeof value === 'number' ? value : null,
          boolValue: typeof value === 'boolean' ? value : null,
        },
      });
    }

    await prisma.lifecycleTransition.create({
      data: {
        personId: person.id,
        from: 'DRAFT',
        to: person.lifecycleState,
        reason: 'Seeded',
        actorKind: 'SYSTEM',
      },
    });

    await prisma.auditEvent.create({
      data: {
        organizationId: organization.id,
        action: 'person.created',
        actorKind: 'SYSTEM',
        actorLabel: 'Seed',
        subjectType: 'Person',
        subjectId: person.id,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Pending approval tasks so the task inbox is not empty
  // -------------------------------------------------------------------------
  const contractorWorkflow = await prisma.workflowDefinition.findFirstOrThrow({
    where: { organizationId: organization.id, key: CONTRACTOR_ONBOARDING.key, active: true },
  });

  for (const email of ['lena@northwind.example', 'kwame.critical@northwind.example']) {
    const person = await prisma.person.findFirst({
      where: { organizationId: organization.id, email },
    });
    if (!person) continue;

    const existing = await prisma.workflowInstance.findFirst({
      where: { personId: person.id },
    });
    if (existing) continue;

    const instance = await prisma.workflowInstance.create({
      data: {
        definitionId: contractorWorkflow.id,
        personId: person.id,
        currentStage: 'sponsor-approval',
        status: 'RUNNING',
        context: {
          person: {
            id: person.id,
            type: person.type,
            lifecycleState: person.lifecycleState,
            riskTier: person.riskTier,
            email: person.email,
            firstName: person.firstName,
            lastName: person.lastName,
            jobTitle: person.jobTitle,
            department: person.department,
            location: person.location,
            startDate: person.startDate?.toISOString() ?? null,
            endDate: person.endDate?.toISOString() ?? null,
            durationDays:
              person.startDate && person.endDate
                ? Math.round(
                    (person.endDate.getTime() - person.startDate.getTime()) /
                      (1000 * 60 * 60 * 24),
                  )
                : null,
            hasVendor: person.vendorCompanyId !== null,
            vendorCompanyId: person.vendorCompanyId,
            hasSponsor: person.sponsorUserId !== null,
          },
          attributes: {},
        },
      },
    });

    await prisma.workflowTask.create({
      data: {
        instanceId: instance.id,
        stageId: 'sponsor-approval',
        kind: 'APPROVAL',
        title: 'Sponsor approval',
        assigneeId: person.sponsorUserId,
        dueAt: daysFromNow(3),
      },
    });
  }

  // -------------------------------------------------------------------------
  // API client for SCIM / REST
  // -------------------------------------------------------------------------
  const existingClient = await prisma.apiClient.findFirst({
    where: { organizationId: organization.id, name: 'Identity Security Cloud' },
  });

  // On a hosted demo the seed runs inside a build log nobody reads, so a
  // randomly generated token would be effectively lost. DEMO_API_TOKEN lets the
  // deployer choose it up front and paste it straight into Postman. It is only
  // honoured alongside DEMO_MODE, so a real deployment always gets a random one.
  const fixedToken =
    process.env.DEMO_MODE === 'true' && process.env.DEMO_API_TOKEN
      ? process.env.DEMO_API_TOKEN
      : null;

  let issuedToken: string | null = null;

  if (!existingClient) {
    issuedToken = fixedToken ?? `nerm_${randomBytes(32).toString('base64url')}`;
    await prisma.apiClient.create({
      data: {
        organizationId: organization.id,
        name: 'Identity Security Cloud',
        tokenHash: createHash('sha256').update(issuedToken).digest('hex'),
        tokenPrefix: issuedToken.slice(0, 11),
        scopes: ['scim:read', 'scim:write', 'api:workflows', 'api:people'],
      },
    });
  } else if (fixedToken) {
    // Re-running the seed with a configured demo token re-points the existing
    // client at it, so redeploying does not silently invalidate the token the
    // deployer already wrote down.
    const tokenHash = createHash('sha256').update(fixedToken).digest('hex');
    if (existingClient.tokenHash !== tokenHash) {
      await prisma.apiClient.update({
        where: { id: existingClient.id },
        data: { tokenHash, tokenPrefix: fixedToken.slice(0, 11) },
      });
      issuedToken = fixedToken;
    }
  }

  console.log('\nSeed complete.\n');
  console.log(
    process.env.DEMO_MODE === 'true'
      ? 'Internal users (sign in with the DEMO_PASSWORD you configured):'
      : 'Internal users (sign in through your IdP, Keycloak password "password"):',
  );
  console.log('  admin.iam@example.com      IAM_ADMIN');
  console.log('  sam.sponsor@example.com    SPONSOR');
  console.log('  sofia.sponsor@example.com  SPONSOR');
  console.log('  iris.auditor@example.com   AUDITOR');
  console.log(`\nVendor administrators (local sign-in, password "${vendorAdminPassword}"):`);
  for (const admin of vendorAdmins) {
    console.log(`  ${admin.email}`);
    console.log(`    TOTP secret: ${admin.secret}`);
  }
  if (issuedToken) {
    console.log('\nAPI token (shown once — store it now):');
    console.log(`  ${issuedToken}`);
  } else {
    console.log('\nAPI client already exists; re-create it in the admin console for a new token.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
