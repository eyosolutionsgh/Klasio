-- The other half of "API access & webhooks": the read-only API lets another system ask, and
-- this lets Klasio tell.

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "lastSentAt" TIMESTAMP(3),

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Webhook_schoolId_idx" ON "Webhook"("schoolId");


-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "Webhook" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Webhook";
CREATE POLICY tenant_isolation ON "Webhook"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Webhook" TO eyo_app;
  END IF;
END
$$;
