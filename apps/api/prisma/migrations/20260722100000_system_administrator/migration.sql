-- The System Administrator: the access-administration job, made possible.
--
-- The IT Administrator preset has existed since 20260718230000_seed_preset_roles and could not do
-- its job. It holds `users.manage` but nothing else a school runs on, and the rule that nobody
-- hands out what they do not hold confined it to handing out its own five permissions — it could
-- not staff the bursar's desk, or any other. `users.delegate` is the exception that separates
-- administering access from holding it.
--
-- Applied only to rows that are still recognisably that role: `presetKey` identifies it, and both
-- administration permissions must still be present. A school that has already re-scoped its copy
-- keeps its own version; this migration does not decide access on their behalf.

UPDATE "StaffRole"
SET
  "permissions" = array_append("permissions", 'users.delegate'),
  "updatedAt" = NOW()
WHERE "presetKey" = 'IT_ADMIN'
  AND 'users.manage' = ANY ("permissions")
  AND 'roles.manage' = ANY ("permissions")
  AND NOT ('users.delegate' = ANY ("permissions"));

-- Renamed only where the school never renamed it themselves. "IT Administrator" reads as the
-- person who fixes the printer; the job here is who may open an account and hand out a role.
UPDATE "StaffRole"
SET
  "name" = 'System Administrator',
  "description" = 'Employed to run accounts and access, so the proprietor does not have to. Hands out any role — including the bursar''s — while holding no student, academic or money access themselves.',
  "updatedAt" = NOW()
WHERE "presetKey" = 'IT_ADMIN'
  AND "name" = 'IT Administrator'
  AND NOT EXISTS (
    -- The unique key is (schoolId, name); refuse rather than collide if the school already has a
    -- role by that name.
    SELECT 1 FROM "StaffRole" other
    WHERE other."schoolId" = "StaffRole"."schoolId"
      AND other."name" = 'System Administrator'
  );
