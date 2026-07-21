-- Several campuses under one school (FEATURES.md §1). A campus is a label with an address,
-- not a tenant: one school, one licence, one database.

-- CreateTable
CREATE TABLE "Campus" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campus_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ClassRoom" ADD COLUMN "campusId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Campus_schoolId_name_key" ON "Campus"("schoolId", "name");

-- AddForeignKey
ALTER TABLE "ClassRoom" ADD CONSTRAINT "ClassRoom_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "Campus" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Campus";
CREATE POLICY tenant_isolation ON "Campus"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Campus" TO eyo_app;
  END IF;
END
$$;
