-- Car line: a guardian announces from the car that they have arrived, and the gate works a
-- visible queue instead of a crowd. Rows are never deleted; wait-time analytics read
-- announcedAt → doneAt.

-- CreateEnum
CREATE TYPE "CarLineStatus" AS ENUM ('WAITING', 'CALLED', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "CarLineEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "announcedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CarLineStatus" NOT NULL DEFAULT 'WAITING',
    "calledAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "CarLineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarLineEntry_schoolId_announcedAt_idx" ON "CarLineEntry"("schoolId", "announcedAt");
CREATE INDEX "CarLineEntry_guardianId_idx" ON "CarLineEntry"("guardianId");

-- AddForeignKey
ALTER TABLE "CarLineEntry" ADD CONSTRAINT "CarLineEntry_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "CarLineEntry" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CarLineEntry";
CREATE POLICY tenant_isolation ON "CarLineEntry"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CarLineEntry" TO eyo_app;
  END IF;
END
$$;
