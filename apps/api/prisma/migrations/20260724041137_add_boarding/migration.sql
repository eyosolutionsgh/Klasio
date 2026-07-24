-- CreateEnum
CREATE TYPE "HostelKind" AS ENUM ('BOYS', 'GIRLS', 'MIXED');

-- CreateTable
CREATE TABLE "Hostel" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "HostelKind" NOT NULL DEFAULT 'MIXED',
    "wardenId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hostel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelRoom" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostelRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardingAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exeat" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "destination" TEXT,
    "outAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueBackAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "approvedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Hostel_schoolId_idx" ON "Hostel"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Hostel_schoolId_name_key" ON "Hostel"("schoolId", "name");

-- CreateIndex
CREATE INDEX "HostelRoom_schoolId_hostelId_idx" ON "HostelRoom"("schoolId", "hostelId");

-- CreateIndex
CREATE UNIQUE INDEX "HostelRoom_hostelId_name_key" ON "HostelRoom"("hostelId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BoardingAssignment_studentId_key" ON "BoardingAssignment"("studentId");

-- CreateIndex
CREATE INDEX "BoardingAssignment_schoolId_roomId_idx" ON "BoardingAssignment"("schoolId", "roomId");

-- CreateIndex
CREATE INDEX "Exeat_schoolId_studentId_idx" ON "Exeat"("schoolId", "studentId");

-- AddForeignKey
ALTER TABLE "HostelRoom" ADD CONSTRAINT "HostelRoom_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingAssignment" ADD CONSTRAINT "BoardingAssignment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "HostelRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security. Every one of these is tenant-owned, so every one needs BOTH a policy and a
-- grant. Only the grant fails loudly; a missing policy fails open, and silently.
ALTER TABLE "Hostel" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Hostel";
CREATE POLICY tenant_isolation ON "Hostel"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "HostelRoom" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "HostelRoom";
CREATE POLICY tenant_isolation ON "HostelRoom"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "BoardingAssignment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BoardingAssignment";
CREATE POLICY tenant_isolation ON "BoardingAssignment"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "Exeat" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Exeat";
CREATE POLICY tenant_isolation ON "Exeat"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Hostel" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "HostelRoom" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "BoardingAssignment" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Exeat" TO eyo_app;
  END IF;
END
$$;

-- Grant the new boarding permissions to the presets that run boarding, on schools that already
-- exist. Fresh installs get them from ROLE_PRESETS in common/permissions.ts; this line is for the
-- schools seeded before boarding shipped. Appended only where absent, so a re-run is a no-op.
UPDATE "StaffRole"
  SET permissions = permissions || ARRAY['housing.view','housing.manage']
  WHERE "presetKey" IN ('HEAD','ASSISTANT_HEAD') AND NOT ('housing.manage' = ANY("permissions"));
UPDATE "StaffRole"
  SET permissions = permissions || ARRAY['housing.view']
  WHERE "presetKey" = 'SCHOOL_NURSE' AND NOT ('housing.view' = ANY("permissions"));
