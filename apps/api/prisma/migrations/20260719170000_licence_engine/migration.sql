-- The licence this box runs on, and the crest's real content type.

-- AlterTable
ALTER TABLE "School" ADD COLUMN "logoMimeType" TEXT;

-- CreateTable
CREATE TABLE "Licence" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "raw" TEXT NOT NULL,
    "licenceId" TEXT NOT NULL,
    "schoolSlug" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "studentCap" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Licence_pkey" PRIMARY KEY ("id")
);

-- Row-level security ENABLED with NO POLICY, which denies the app role everything.
--
-- This is the PlatformAdmin shape, not the tenant shape: a licence belongs to the server, not to
-- the school on it, so it carries no schoolId and there is nothing for a tenant policy to compare.
-- Every read and write goes through LicenceService on the owner connection. A stray tenant-side
-- query cannot reach it, which is the point — the tier is not something a school gets to write.
ALTER TABLE "Licence" ENABLE ROW LEVEL SECURITY;
