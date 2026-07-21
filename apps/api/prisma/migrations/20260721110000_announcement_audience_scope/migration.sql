-- Who a notice is *for*, as opposed to `audience`, which only says which portal shows it.
-- All three null means the whole school, which is what every existing row is.
ALTER TABLE "Announcement" ADD COLUMN     "classId" TEXT,
ADD COLUMN     "levelId" TEXT,
ADD COLUMN     "routeId" TEXT;
