-- Integrity that Prisma's schema language cannot express.

-- 1. Role assignment uniqueness with a nullable scope.
--
-- Postgres treats NULLs as distinct, so the generated unique index would happily
-- allow the same user to hold IAM_ADMIN twenty times over. NULLS NOT DISTINCT
-- (Postgres 15+) makes the constraint mean what the schema says it means.
DROP INDEX IF EXISTS "RoleAssignment_userId_role_vendorCompanyId_key";

CREATE UNIQUE INDEX "RoleAssignment_userId_role_vendorCompanyId_key"
  ON "RoleAssignment" ("userId", "role", "vendorCompanyId")
  NULLS NOT DISTINCT;

-- 2. A VENDOR_ADMIN assignment must name a vendor; the org-wide roles must not.
--
-- This is the database half of the rule the authorization layer relies on: if a
-- VENDOR_ADMIN row could exist with a null scope, `personScope` would have to
-- guess what it meant. It cannot exist.
ALTER TABLE "RoleAssignment"
  DROP CONSTRAINT IF EXISTS "RoleAssignment_scope_matches_role";

ALTER TABLE "RoleAssignment"
  ADD CONSTRAINT "RoleAssignment_scope_matches_role" CHECK (
    ("role" = 'VENDOR_ADMIN' AND "vendorCompanyId" IS NOT NULL)
    OR ("role" <> 'VENDOR_ADMIN' AND "vendorCompanyId" IS NULL)
  );

-- 3. A person's end date cannot precede their start date.
ALTER TABLE "Person"
  DROP CONSTRAINT IF EXISTS "Person_dates_ordered";

ALTER TABLE "Person"
  ADD CONSTRAINT "Person_dates_ordered" CHECK (
    "startDate" IS NULL OR "endDate" IS NULL OR "endDate" >= "startDate"
  );

-- 4. Make the audit log append-only at the database level.
--
-- The application has no update or delete path for AuditEvent, but "we don't
-- call it" is a convention and this is a control. A trigger makes tampering
-- fail loudly regardless of which client attempts it.
CREATE OR REPLACE FUNCTION nerm_audit_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AuditEvent_no_update" ON "AuditEvent";
CREATE TRIGGER "AuditEvent_no_update"
  BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION nerm_audit_append_only();

DROP TRIGGER IF EXISTS "AuditEvent_no_delete" ON "AuditEvent";
CREATE TRIGGER "AuditEvent_no_delete"
  BEFORE DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION nerm_audit_append_only();

-- Lifecycle transitions are evidence too.
DROP TRIGGER IF EXISTS "LifecycleTransition_no_update" ON "LifecycleTransition";
CREATE TRIGGER "LifecycleTransition_no_update"
  BEFORE UPDATE ON "LifecycleTransition"
  FOR EACH ROW EXECUTE FUNCTION nerm_audit_append_only();
