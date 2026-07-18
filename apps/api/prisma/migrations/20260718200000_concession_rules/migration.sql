-- CreateEnum
CREATE TYPE "ConcessionKind" AS ENUM ('SCHOLARSHIP', 'SIBLING');

-- CreateEnum
CREATE TYPE "ConcessionBasis" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateTable
CREATE TABLE "ConcessionRule" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ConcessionKind" NOT NULL,
    "basis" "ConcessionBasis" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "fromSibling" INTEGER,
    "levelId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConcessionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConcessionAward" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "awardedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConcessionAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConcessionRule_schoolId_active_idx" ON "ConcessionRule"("schoolId", "active");

-- CreateIndex
CREATE INDEX "ConcessionAward_schoolId_studentId_idx" ON "ConcessionAward"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ConcessionAward_ruleId_studentId_key" ON "ConcessionAward"("ruleId", "studentId");

-- AddForeignKey
ALTER TABLE "ConcessionRule" ADD CONSTRAINT "ConcessionRule_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcessionAward" ADD CONSTRAINT "ConcessionAward_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ConcessionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcessionAward" ADD CONSTRAINT "ConcessionAward_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-Level Security for the concession tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ConcessionRule', 'ConcessionAward'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("schoolId" = app_current_school()) '
      'WITH CHECK ("schoolId" = app_current_school())', t);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eyo_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eyo_app;
  END IF;
END $$;
