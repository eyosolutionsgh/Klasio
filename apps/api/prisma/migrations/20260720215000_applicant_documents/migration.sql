-- Papers attached to an applicant. On enrolment the rows become StudentDocument rows over the
-- same storage keys, so a birth certificate handed in at application is never asked for twice.

-- CreateTable
CREATE TABLE "ApplicantDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicantDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicantDocument_schoolId_applicantId_idx" ON "ApplicantDocument"("schoolId", "applicantId");

-- AddForeignKey
ALTER TABLE "ApplicantDocument" ADD CONSTRAINT "ApplicantDocument_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "ApplicantDocument" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ApplicantDocument";
CREATE POLICY tenant_isolation ON "ApplicantDocument"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ApplicantDocument" TO eyo_app;
  END IF;
END
$$;
