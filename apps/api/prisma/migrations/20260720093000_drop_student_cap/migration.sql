-- Enrolment caps are gone: packages differ by what they can do, not by how many children a
-- school may enrol. The column recorded the cap from the installed licence and nothing reads it.
--
-- The licence payload keeps a `studentCap` field, still emitted as null so a server predating
-- this change accepts a newly issued licence. It is parsed and discarded, never stored.
ALTER TABLE "Licence" DROP COLUMN IF EXISTS "studentCap";
