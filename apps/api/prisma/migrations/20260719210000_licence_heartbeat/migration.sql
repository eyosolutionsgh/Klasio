-- When this box last reported to its supplier.
--
-- Shown on the licence screen: a product sold partly on not phoning home must be able to tell a
-- school exactly when its server last did. The heartbeat itself is opt-in — see
-- apps/api/src/licence/heartbeat.ts — and never affects what the school may do.
ALTER TABLE "Licence" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);
ALTER TABLE "Licence" ADD COLUMN "lastHeartbeatOk" BOOLEAN;
