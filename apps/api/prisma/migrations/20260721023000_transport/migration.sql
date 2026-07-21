-- School transport (FEATURES.md §10): routes, stops, manifests, boarding/alighting scans.
-- Billing rides the fees module — a route may point at an optional FeeItem. No live GPS by
-- deliberate scope; the scan log is the record of who was on which bus.

-- CreateEnum
CREATE TYPE "TransportDirection" AS ENUM ('BOARD', 'ALIGHT');

-- CreateTable
CREATE TABLE "TransportRoute" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "feeItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransportStop" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TransportStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransportRider" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "stopId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportRider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransportScan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "direction" "TransportDirection" NOT NULL,
    "recordedById" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientRef" TEXT,

    CONSTRAINT "TransportScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransportRoute_schoolId_name_key" ON "TransportRoute"("schoolId", "name");
CREATE INDEX "TransportStop_schoolId_routeId_idx" ON "TransportStop"("schoolId", "routeId");
CREATE UNIQUE INDEX "TransportRider_studentId_key" ON "TransportRider"("studentId");
CREATE INDEX "TransportRider_schoolId_routeId_idx" ON "TransportRider"("schoolId", "routeId");
CREATE UNIQUE INDEX "TransportScan_schoolId_clientRef_key" ON "TransportScan"("schoolId", "clientRef");
CREATE INDEX "TransportScan_schoolId_scannedAt_idx" ON "TransportScan"("schoolId", "scannedAt");
CREATE INDEX "TransportScan_studentId_idx" ON "TransportScan"("studentId");

-- AddForeignKey
ALTER TABLE "TransportStop" ADD CONSTRAINT "TransportStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransportRider" ADD CONSTRAINT "TransportRider_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransportRider" ADD CONSTRAINT "TransportRider_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransportRider" ADD CONSTRAINT "TransportRider_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "TransportStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TransportScan" ADD CONSTRAINT "TransportScan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransportScan" ADD CONSTRAINT "TransportScan_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "TransportRoute" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TransportRoute";
CREATE POLICY tenant_isolation ON "TransportRoute"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "TransportStop" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TransportStop";
CREATE POLICY tenant_isolation ON "TransportStop"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "TransportRider" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TransportRider";
CREATE POLICY tenant_isolation ON "TransportRider"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "TransportScan" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TransportScan";
CREATE POLICY tenant_isolation ON "TransportScan"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "TransportRoute" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "TransportStop" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "TransportRider" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "TransportScan" TO eyo_app;
  END IF;
END
$$;
