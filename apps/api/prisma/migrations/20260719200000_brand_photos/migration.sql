-- Photographs a school chooses for its own sign-in pages.
--
-- The product ships CC0 defaults so a fresh install looks finished, but those are pictures of
-- somebody else's school. A row here overrides one; deleting it falls back to the default rather
-- than to an empty panel.

-- CreateEnum
CREATE TYPE "BrandPhotoSlot" AS ENUM ('STAFF', 'FAMILY', 'STUDENT', 'GENERAL');

-- CreateTable
CREATE TABLE "BrandPhoto" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "slot" "BrandPhotoSlot" NOT NULL,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandPhoto_schoolId_slot_key" ON "BrandPhoto"("schoolId", "slot");

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "BrandPhoto" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BrandPhoto";
CREATE POLICY tenant_isolation ON "BrandPhoto"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

-- The grant should be covered by ALTER DEFAULT PRIVILEGES from 20260719191000, but it is repeated
-- explicitly because default privileges only apply to objects created by the role that set them,
-- and a database restored or provisioned differently is exactly where that assumption breaks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "BrandPhoto" TO eyo_app;
  END IF;
END
$$;
