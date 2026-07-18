import { ROLE_PRESETS } from '../src/common/permissions';
const esc = (s) => s.replace(/'/g, "''");
const arr = (xs) => `ARRAY[${xs.map((x) => `'${esc(x)}'`).join(',')}]::text[]`;
let sql = `-- Seed the preset roles for every existing school, and put existing staff on one.
--
-- Generated from ROLE_PRESETS in common/permissions.ts. Inlined rather than run from TypeScript
-- because a migration has to be reproducible from SQL alone — a future change to the presets
-- must not retroactively alter what this migration did.
--
-- Existing accounts are mapped from their legacy enum role. The proprietor is deliberately left
-- without a role row: OWNER holds every permission unconditionally, and giving them a narrowable
-- role would be the one way to lock a school out of itself.
`;
for (const r of ROLE_PRESETS) {
  sql += `
INSERT INTO "StaffRole" ("id", "schoolId", "name", "description", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, '${esc(r.name)}', '${esc(r.description)}', ${arr(r.permissions)}, '${r.key}', NOW(), NOW()
FROM "School" s
ON CONFLICT ("schoolId", "name") DO NOTHING;
`;
}
sql += `
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
`;
process.stdout.write(sql);
