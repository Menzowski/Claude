# Non-Employee Risk Management

Onboarding and lifecycle management for external workers — contractors, vendor staff,
volunteers, interns — with configurable workflows, delegated administration, SSO, and a
SCIM 2.0 source that Identity Security Cloud can aggregate.

This is the MVP slice: narrow in feature count, but real end to end. Everything described
below runs.

---

## What is here

| Capability | State |
|---|---|
| Data-driven profile schema (fields are configuration, not code) | Working |
| Lifecycle state machine with a recorded transition history | Working |
| Configurable workflow engine — versioned JSON, UI **and** REST authoring | Working |
| Dry-run simulator for workflow definitions | Working |
| Sponsor console, stepped onboarding wizard, task inbox | Working |
| Delegated vendor administration portal (scoped) | Working |
| SSO via config-driven OIDC; vendor accounts with password + mandatory TOTP | Working |
| SCIM 2.0 server (Users, Groups, discovery, RFC 7644 filters, ETags, PATCH) | Working |
| Append-only audit log, enforced by database trigger | Working |
| Field-level PII masking | Working |
| Expiry and SLA sweeps | Working |
| Document upload to object storage | Modelled; upload path not yet built |
| Email notification delivery | Stage runs and is audited; delivery not yet built |

---

## Just want to see it?

**[DEPLOY.md](./DEPLOY.md)** puts this on a free public URL in about 15 minutes with no
terminal and no code — two free accounts (Vercel and Neon) and some form filling. Written
for a non-developer.

That path turns on **demo mode**, which replaces single sign-on with one shared password so
the internal roles are reachable on hosting that has no identity provider. It is off by
default and must stay off for anything real — see [Demo mode](#demo-mode) below.

## Running it locally

Requires Node 22+, pnpm, and Postgres 15+ (16 recommended — the schema uses
`NULLS NOT DISTINCT`).

```bash
pnpm install
cp .env.example .env          # then set AUTH_SECRET: openssl rand -base64 32

docker compose up -d          # Postgres, Keycloak (local OIDC), MinIO
pnpm db:migrate
pnpm db:seed                  # prints sign-in credentials and an API token — save it

pnpm dev                      # http://localhost:3000
```

If you cannot run Docker, any Postgres will do — point `DATABASE_URL` at it and skip the
Keycloak service (SSO simply won't be offered; vendor sign-in still works).

The seed prints, once:

- Internal users for Keycloak (`admin.iam@`, `sam.sponsor@`, `sofia.sponsor@`,
  `iris.auditor@` — all password `password`)
- Two vendor administrators with their TOTP secrets
- An API token for the SCIM and REST surfaces

### Tests

```bash
pnpm test          # unit + integration (integration needs a migrated, seeded database)
pnpm typecheck
pnpm lint
pnpm build
```

---

## Architecture

One Next.js application, three surfaces over one domain layer.

```
src/app
├─ (internal)  sponsor console, person detail, task inbox, admin
├─ vendor/     delegated administration portal — scoped, visually distinct
├─ api/v1/     REST: workflows, scheduled jobs
└─ scim/v2/    SCIM 2.0 server

src/lib
├─ domain/     lifecycle state machine, person service, transitions
├─ workflow/   definition schema, sandboxed evaluator, engine, versioning
├─ authz/      the authorization chokepoint
├─ scim/       filter parser, resource mapper, request plumbing
├─ queries/    every scoped read the UI performs
└─ audit/      append-only event writer
```

### Four decisions worth knowing about

**Authorization is a query fragment, not a per-route check.**
`src/lib/authz/scope.ts` returns Prisma `where` fragments. Every read composes one. A vendor
administrator cannot *express* a query that reaches another vendor's records — even
`AND`-ing an explicit person id onto the scope returns nothing, which is asserted as a test.
An ESLint rule stops application code importing the raw Prisma client, so a new page cannot
quietly skip the scope; reads live in `src/lib/queries/`.

**Lifecycle is a state machine.**
`src/lib/domain/lifecycle.ts` is the only place transitions are defined. The UI offers only
legal transitions, SCIM's `active` flag is *derived* from lifecycle state rather than stored
alongside it, and an illegal transition throws rather than being written. Every change lands
in `LifecycleTransition` and the audit log.

**Workflow definitions are data, and there is only one of them.**
A definition is versioned JSON. The admin editor and the REST API write the same document
through the same validation — the UI is a rendering of the JSON, never a parallel format.
Published versions are immutable: `PUT` appends a version, `activate` chooses which version
new instances start on, and running instances pin the version they began with. Conditions
are evaluated by a hand-written parser (`src/lib/workflow/evaluator.ts`) with no `eval`, no
function calls and no prototype access — configuration is authored by administrators, which
makes an embedded JS engine unacceptable.

**Audit is append-only in the database, not by convention.**
A trigger rejects `UPDATE` and `DELETE` on `AuditEvent`. Sensitive field values are masked
when the event is written, so the log cannot become a second copy of everyone's personal
data.

---

## Connecting Identity Security Cloud

Point a SCIM 2.0 source at `/scim/v2` with a bearer token holding the `scim:read` scope.

- Discovery: `/scim/v2/ServiceProviderConfig`, `/Schemas`, `/ResourceTypes`
- `/Users` — filtering, sorting, cursor-stable pagination, ETags, PATCH
- `/Groups` — vendor companies, with their active workers as members
- Custom extension `urn:nerm:2.0:NonEmployee` carries `personType`, `lifecycleState`,
  `riskTier`, `startDate`, `endDate`, `location` and `vendorCompany`, so ISC can write policy
  against them directly

Filters that cannot be honoured return **400**, never a silent full result set — an
unrecognised clause quietly ignored is how an over-broad aggregation goes unnoticed for
weeks. Supported: `eq ne co sw ew gt ge lt le pr`, `and or not`, grouping, and URN-prefixed
attribute paths.

`DELETE` deactivates rather than destroying: the record is evidence of who had access and
when.

Inbound provisioning (`POST /scim/v2/Users`) creates the person in `DRAFT`. Required custom
attributes are *not* enforced at the SCIM boundary — a SCIM client cannot know that this
organization made "cost centre" mandatory — so a sponsor completes the record before it can
be submitted.

---

## Authoring workflows

Two paths, one artifact.

**Admin console** — `/admin/workflows`. Edit the JSON, **Validate**, **Simulate** against a
sample profile to see which stages the conditions select, then **Publish version**.

**REST / Postman / CI** — import `postman/nerm-platform.postman_collection.json`; the
*Workflow round trip* folder runs export → edit → validate → publish → simulate → activate
in order.

```
GET    /api/v1/workflows                      latest version of each definition
GET    /api/v1/workflows/{key}                all versions
GET    /api/v1/workflows/{key}/versions/{n}   exact JSON — this is what PUT accepts
POST   /api/v1/workflows                      create (version 1, activated)
PUT    /api/v1/workflows/{key}                publish a new version (inactive)
POST   /api/v1/workflows/validate             validate; errors carry JSON paths
POST   /api/v1/workflows/{key}/simulate       dry run → the stage path
POST   /api/v1/workflows/{key}/activate       promote a version
```

A definition:

```jsonc
{
  "key": "contractor-onboarding",
  "name": "Contractor onboarding",
  "trigger": { "on": "person.created", "when": "person.type == 'CONTRACTOR'" },
  "stages": [
    { "id": "sponsor-approval", "type": "approval",
      "assignee": { "kind": "sponsor" },
      "sla": "P3D", "onTimeout": "escalate",
      "escalateTo": { "kind": "role", "role": "IAM_ADMIN" },
      "onReject": "REJECTED" },
    { "id": "nda", "type": "document",
      "assignee": { "kind": "sponsor" }, "requires": ["NDA"] },
    { "id": "screening", "type": "task",
      "assignee": { "kind": "role", "role": "IAM_ADMIN" },
      "when": "person.riskTier in ['HIGH','CRITICAL']" },
    { "id": "approve",  "type": "transition", "to": "APPROVED" },
    { "id": "activate", "type": "transition", "to": "ACTIVE" }
  ]
}
```

Stage types: `approval`, `document`, `task`, `transition`, `notify`.
Assignees: `sponsor`, `subject`, `vendorOwner`, `role`, `user`.
Conditions read `person.*` (including the computed `durationDays`, `hasVendor`) and
`attributes.*`.

---

## Scheduled jobs

Two sweeps, driven by whatever scheduler you use, authenticated with `JOB_TRIGGER_SECRET`:

```bash
curl -X POST -H "x-job-secret: $JOB_TRIGGER_SECRET" $BASE/api/v1/jobs/expiry
curl -X POST -H "x-job-secret: $JOB_TRIGGER_SECRET" $BASE/api/v1/jobs/sla
```

`expiry` moves people toward `EXPIRING` and then `INACTIVE` as their end date approaches and
passes. `sla` escalates or auto-approves overdue tasks. Run both daily; without the first,
an end date is a decoration rather than a control.

---

## Demo mode

`DEMO_MODE=true` registers a third Auth.js provider that admits **provisioned internal
users** against a single shared `DEMO_PASSWORD`, standing in for the corporate IdP. It
exists so the product can be demonstrated on hosting with no identity provider attached.

It is a deliberate weakening of authentication. What it does *not* relax:

- The user must already exist and be active — it replaces the identity provider, not the
  entitlement decision.
- Internal accounts only. External vendor accounts keep mandatory TOTP; there is no path
  here that skips a second factor for an account that has one.
- Authorization is untouched. A demo session flows through the same
  `currentActor` → `personScope` chain, so role scoping and vendor isolation behave
  identically (verified: a demo sponsor is refused `/admin/*` and `/audit`).

Guardrails: the provider is not registered at all unless the flag is set; the app refuses
to boot if `DEMO_MODE=true` without a password of at least 12 characters; a
non-dismissible banner appears on every page; and the audit log records
`method: 'demo'` so those sessions stay distinguishable.

**Remove `DEMO_MODE` and `DEMO_PASSWORD` before this holds any real personal data.**

## Security posture

- OIDC for internal users, configured by environment variable so the same build runs against
  Entra ID, Okta, Keycloak or ISC. A valid corporate token is **not** an entitlement: the
  user must already be provisioned, or sign-in is refused.
- External vendor accounts are invite-based, Argon2id-hashed, and TOTP is mandatory — not an
  optional second step.
- API tokens are stored as SHA-256 digests and compared in constant time; the plaintext is
  shown once.
- Strict CSP with no inline-script allowance (the theme script is a static file for exactly
  this reason), HSTS, frame-deny, nosniff.
- Database-level integrity: append-only audit, a check constraint that a `VENDOR_ADMIN`
  assignment must name a vendor and an org-wide role must not, and date ordering on
  engagements.

---

## Known gaps

Honest list of what a production deployment still needs:

- **Attachment upload.** `Attachment` is modelled and MinIO is in the compose file, but the
  signed-URL upload path and virus-scan hook are not built. Document stages create tasks and
  can be marked complete; they do not yet hold a file.
- **Notification delivery.** `notify` stages run and are audited, but nothing sends email.
- **Rate limiting** is not implemented; put it at the edge or add it to the auth and API
  routes before exposing this publicly.
- **Vendor administrator invitation flow.** Accounts are seedable and the sign-in path works;
  there is no UI yet to invite one or to enrol their authenticator.
- **Multi-tenancy** is modelled (`Organization`) but untested beyond a single tenant.
- **GDPR erasure.** Retention hooks are designed for but not implemented; note that the
  audit trigger blocks deletion, so erasure needs a deliberate, audited procedure rather than
  a cascade.
- The **person edit** screen is read-only after creation; changes go through lifecycle
  actions and SCIM. An edit form is the obvious next increment.
