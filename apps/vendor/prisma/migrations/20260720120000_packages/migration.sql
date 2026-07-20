-- Packages: named sets of features the vendor builds and sells as one thing.
--
-- Held as codes rather than as a tier so a package can be any combination, including one that
-- leaves out something a built-in tier carries. A school never reads this table — what reaches a
-- school is the resolved list frozen onto its licence.
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entitlements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tier" "Tier" NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Package_name_key" ON "Package"("name");
CREATE INDEX "Package_archived_name_idx" ON "Package"("archived", "name");

-- What was sold, frozen onto the licence. A package can be renamed or retired later; a licence has
-- to keep saying what it actually granted, so both the name and the resolved codes are copied.
ALTER TABLE "Licence" ADD COLUMN "packageId" TEXT;
ALTER TABLE "Licence" ADD COLUMN "packageName" TEXT;
ALTER TABLE "Licence" ADD COLUMN "entitlements" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Licence"
  ADD CONSTRAINT "Licence_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;
