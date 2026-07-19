-- CreateEnum
CREATE TYPE "NoticeLevel" AS ENUM ('INFO', 'WARNING');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolInvitation" (
    "id" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tier" "Tier" NOT NULL DEFAULT 'BASIC',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "schoolId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformNotice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "level" "NoticeLevel" NOT NULL DEFAULT 'INFO',
    "sentById" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolInvitation_tokenHash_key" ON "SchoolInvitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolInvitation_schoolId_key" ON "SchoolInvitation"("schoolId");

-- CreateIndex
CREATE INDEX "SchoolInvitation_email_idx" ON "SchoolInvitation"("email");

-- CreateIndex
CREATE INDEX "SchoolInvitation_expiresAt_idx" ON "SchoolInvitation"("expiresAt");

-- CreateIndex
CREATE INDEX "PlatformNotice_schoolId_createdAt_idx" ON "PlatformNotice"("schoolId", "createdAt");

-- AddForeignKey
ALTER TABLE "SchoolInvitation" ADD CONSTRAINT "SchoolInvitation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolInvitation" ADD CONSTRAINT "SchoolInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformNotice" ADD CONSTRAINT "PlatformNotice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformNotice" ADD CONSTRAINT "PlatformNotice_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-Level Security for the platform tables.
--
-- Two different rules here, on purpose.
--
-- `PlatformAdmin` and `SchoolInvitation` belong to the vendor, not to any school. They get RLS
-- enabled with NO policy at all, which denies every row to the app role: there is no tenant they
-- could ever legitimately belong to, so the honest policy is "none of this is yours". Policies
-- are not FORCEd, so the owner connection (`db.system`) still reads them — which is exactly how
-- the platform module is written, and the only way it can be. A school-scoped request that
-- somehow reached for a password hash or a live invitation token gets nothing back.
--
-- `PlatformNotice` is the opposite: it carries `schoolId` because a school reads its own notices
-- through the ordinary tenant-scoped client, so it takes the standard policy like any other
-- tenant table. The vendor writes them through the owner connection.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PlatformAdmin', 'SchoolInvitation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  END LOOP;

  ALTER TABLE "PlatformNotice" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON "PlatformNotice";
  CREATE POLICY tenant_isolation ON "PlatformNotice"
    USING ("schoolId" = app_current_school())
    WITH CHECK ("schoolId" = app_current_school());

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eyo_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eyo_app;
  END IF;
END $$;
