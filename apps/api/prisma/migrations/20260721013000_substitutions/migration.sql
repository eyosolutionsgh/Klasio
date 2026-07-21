-- Substitution management (FEATURES.md §6): cover for one lesson on one date. A null relief
-- teacher records the honest outcome — the lesson goes unstaffed.

-- CreateTable
CREATE TABLE "Substitution" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reliefTeacherId" TEXT,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Substitution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Substitution_schoolId_slotId_date_key" ON "Substitution"("schoolId", "slotId", "date");
CREATE INDEX "Substitution_schoolId_date_idx" ON "Substitution"("schoolId", "date");

-- AddForeignKey
ALTER TABLE "Substitution" ADD CONSTRAINT "Substitution_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Substitution" ADD CONSTRAINT "Substitution_reliefTeacherId_fkey" FOREIGN KEY ("reliefTeacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "Substitution" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Substitution";
CREATE POLICY tenant_isolation ON "Substitution"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Substitution" TO eyo_app;
  END IF;
END
$$;
