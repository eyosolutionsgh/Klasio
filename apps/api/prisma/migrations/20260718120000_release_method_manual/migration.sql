-- ReleaseMethod recorded OVERRIDE both for "identified by hand at the desk" and, implicitly,
-- for "released against advice". Those are different facts: how someone was identified, and
-- whether staff overrode a warning. The second is already carried by ReleaseLog.overrideReason,
-- so the enum now only describes identification and OVERRIDE becomes MANUAL.
ALTER TYPE "ReleaseMethod" RENAME TO "ReleaseMethod_old";

CREATE TYPE "ReleaseMethod" AS ENUM ('QR', 'PIN', 'MANUAL');

ALTER TABLE "ReleaseLog"
  ALTER COLUMN "method" TYPE "ReleaseMethod"
  USING (
    CASE WHEN "method"::text = 'OVERRIDE' THEN 'MANUAL' ELSE "method"::text END
  )::"ReleaseMethod";

DROP TYPE "ReleaseMethod_old";
