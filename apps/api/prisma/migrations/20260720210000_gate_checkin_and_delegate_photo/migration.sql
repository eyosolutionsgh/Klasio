-- The gate's other half: morning drop-off check-in, mirroring ReleaseLog, plus a photo on
-- delegates so the release screen can show a face for anyone authorised to collect — a card
-- can be lent, a face cannot.

-- AlterTable
ALTER TABLE "PickupDelegate" ADD COLUMN "photoUrl" TEXT;

-- CreateTable
CREATE TABLE "CheckInLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "broughtBy" TEXT,
    "collectorKind" TEXT,
    "collectorId" TEXT,
    "method" "ReleaseMethod" NOT NULL DEFAULT 'MANUAL',
    "recordedById" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientRef" TEXT,

    CONSTRAINT "CheckInLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckInLog_schoolId_clientRef_key" ON "CheckInLog"("schoolId", "clientRef");
CREATE INDEX "CheckInLog_schoolId_checkedInAt_idx" ON "CheckInLog"("schoolId", "checkedInAt");
CREATE INDEX "CheckInLog_studentId_idx" ON "CheckInLog"("studentId");

-- AddForeignKey
ALTER TABLE "CheckInLog" ADD CONSTRAINT "CheckInLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "CheckInLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CheckInLog";
CREATE POLICY tenant_isolation ON "CheckInLog"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

-- Repeated explicitly (see 20260719200000_brand_photos): default privileges only apply to
-- objects created by the role that set them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CheckInLog" TO eyo_app;
  END IF;
END
$$;
