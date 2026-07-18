-- Seed the preset roles for every existing school, and put existing staff on one.
--
-- Generated from ROLE_PRESETS in common/permissions.ts. Inlined rather than run from TypeScript
-- because a migration has to be reproducible from SQL alone — a future change to the presets
-- must not retroactively alter what this migration did.
--
-- Existing accounts are mapped from their legacy enum role. The proprietor is deliberately left
-- without a role row: OWNER holds every permission unconditionally, and giving them a narrowable
-- role would be the one way to lock a school out of itself.

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'Head Teacher', 'Runs the school day to day. Sees the money but does not handle it.', ARRAY['students.view','attendance.view','attendance.mark','marks.view','marks.enter','reports.view','timetable.view','resources.view','students.create','students.edit','students.lifecycle','students.guardians','students.medical','students.documents','students.export','admissions.view','admissions.manage','attendance.dashboards','assessment.configure','reports.generate','reports.remark.head','reports.publish','timetable.manage','resources.manage','fees.view','pickup.view','pickup.manage','comms.announce','comms.sms','comms.whatsapp','calendar.manage','school.settings','records.configure','users.view','audit.view','returns.view']::text[], 'HEAD', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'Assistant Head', 'Deputises on academics and discipline. No access to money.', ARRAY['students.view','attendance.view','attendance.mark','marks.view','marks.enter','reports.view','timetable.view','resources.view','students.edit','students.guardians','attendance.dashboards','assessment.configure','reports.generate','reports.remark.head','timetable.manage','resources.manage','pickup.view','comms.announce','calendar.manage']::text[], 'ASSISTANT_HEAD', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'Head of Department', 'Leads a subject area: marks, schemes of work, and their department’s results.', ARRAY['students.view','attendance.view','attendance.mark','marks.view','marks.enter','reports.view','timetable.view','resources.view','assessment.configure','reports.generate','reports.remark.teacher','resources.manage','timetable.view']::text[], 'HEAD_OF_DEPARTMENT', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'Class Teacher', 'Owns a class: register, marks, and the class teacher’s remark.', ARRAY['students.view','attendance.view','attendance.mark','marks.view','marks.enter','reports.view','timetable.view','resources.view','students.medical','reports.remark.teacher','reports.generate','pickup.view']::text[], 'CLASS_TEACHER', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'Subject Teacher', 'Teaches a subject across classes. Marks only, no remarks.', ARRAY['students.view','attendance.view','attendance.mark','marks.view','marks.enter','reports.view','timetable.view','resources.view']::text[], 'SUBJECT_TEACHER', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'Exams Officer', 'Runs assessment and the terminal reports, without teaching.', ARRAY['students.view','marks.view','assessment.configure','reports.view','reports.generate','reports.publish','returns.view']::text[], 'EXAMS_OFFICER', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'Bursar', 'Runs the school’s finances: fees, invoicing, reconciliation.', ARRAY['students.view','fees.view','fees.record_payment','fees.structure','fees.invoice','fees.concessions','fees.reconcile','fees.deposits','fees.gateways','fees.export','comms.sms','audit.view']::text[], 'BURSAR', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'Accounts Clerk', 'Takes payments at the counter. Cannot change what is owed, or reconcile what arrived.', ARRAY['students.view','fees.view','fees.record_payment','fees.deposits']::text[], 'ACCOUNTS_CLERK', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'Registrar', 'Admissions and enrolment.', ARRAY['students.view','students.create','students.edit','students.guardians','students.documents','students.import','admissions.view','admissions.manage','records.configure']::text[], 'REGISTRAR', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'Front Desk', 'Reception: enquiries, contacts, and the dismissal gate.', ARRAY['students.view','students.guardians','attendance.view','admissions.view','pickup.view','pickup.release','pickup.manage','comms.announce','calendar.manage']::text[], 'FRONT_DESK', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'School Nurse', 'Sick bay. Sees who is in school and their medical notes, nothing else.', ARRAY['students.view','students.medical','attendance.view','pickup.view']::text[], 'SCHOOL_NURSE', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'Librarian', 'Learning resources.', ARRAY['students.view','resources.view','resources.manage']::text[], 'LIBRARIAN', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'IT Administrator', 'Manages accounts and access. Deliberately holds no student, academic or money permissions.', ARRAY['users.view','users.manage','roles.manage','audit.view','school.branding']::text[], 'IT_ADMIN', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;

-- Map existing staff onto a preset. TEACHER becomes Class Teacher rather than Subject Teacher:
-- teachers already wrote the class-teacher remark, and taking that away on upgrade would be a
-- silent regression for every school.
UPDATE "User" u SET "staffRoleId" = r.id
FROM "StaffRole" r
WHERE r."schoolId" = u."schoolId"
  AND u."staffRoleId" IS NULL
  AND r."presetKey" = CASE u."role"
    WHEN 'HEAD' THEN 'HEAD'
    WHEN 'BURSAR' THEN 'BURSAR'
    WHEN 'TEACHER' THEN 'CLASS_TEACHER'
    WHEN 'FRONT_DESK' THEN 'FRONT_DESK'
  END;
