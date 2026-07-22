-- Let a school connect its own WhatsApp number from the portal.
--
-- The credentials were read from the box's environment, which meant the only way to connect
-- WhatsApp was to edit a file on the server — and until somebody did, the WhatsApp screen was
-- permanently empty. Per school, encrypted at rest, like the payment gateways and social tokens.
CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "displayNumber" TEXT,
    "wabaId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "connectedById" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppAccount_schoolId_key" ON "WhatsAppAccount"("schoolId");

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "WhatsAppAccount" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WhatsAppAccount";
CREATE POLICY tenant_isolation ON "WhatsAppAccount"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "WhatsAppAccount" TO eyo_app;
  END IF;
END
$$;
