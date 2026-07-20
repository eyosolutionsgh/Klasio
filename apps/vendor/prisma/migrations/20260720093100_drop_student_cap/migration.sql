-- Enrolment caps are gone. The vendor no longer sells or records a headcount ceiling, and a
-- school's report no longer carries one.
--
-- Heartbeat."raw" keeps the whole payload as received, so reports from servers that still send
-- the field lose nothing by this.
ALTER TABLE "Licence" DROP COLUMN IF EXISTS "studentCap";
ALTER TABLE "Heartbeat" DROP COLUMN IF EXISTS "studentCap";
