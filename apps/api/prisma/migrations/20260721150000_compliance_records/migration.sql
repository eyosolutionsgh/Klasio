-- The name WAEC will print on a certificate, when it differs from the one the school uses daily.
ALTER TABLE "Student" ADD COLUMN     "certificateName" TEXT;

-- NTC licence and qualification: what a NaSIA inspection and the annual census both ask for.
ALTER TABLE "User" ADD COLUMN     "ntcNumber" TEXT,
ADD COLUMN     "qualification" TEXT;

CREATE TABLE "CsspsChoice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "schoolName" TEXT NOT NULL,
    "programme" TEXT,
    "category" TEXT,
    "residency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsspsChoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CsspsChoice_schoolId_studentId_idx" ON "CsspsChoice"("schoolId", "studentId");

CREATE UNIQUE INDEX "CsspsChoice_studentId_rank_key" ON "CsspsChoice"("studentId", "rank");

ALTER TABLE "CsspsChoice" ADD CONSTRAINT "CsspsChoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "CsspsChoice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CsspsChoice";
CREATE POLICY tenant_isolation ON "CsspsChoice"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CsspsChoice" TO eyo_app;
  END IF;
END
$$;
