-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_schoolId_name_key" ON "NumberSequence"("schoolId", "name");


-- NumberSequence is tenant-owned like every other table carrying schoolId, so it gets the same
-- isolation. Without it a school could read — and by incrementing, disturb — another school's
-- receipt run.
ALTER TABLE "NumberSequence" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NumberSequence";
CREATE POLICY tenant_isolation ON "NumberSequence"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "NumberSequence" TO eyo_app;
  END IF;
END $$;
