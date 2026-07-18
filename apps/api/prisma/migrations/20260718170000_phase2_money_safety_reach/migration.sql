-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'DISPUTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ApplicantStage" AS ENUM ('ENQUIRY', 'APPLIED', 'ASSESSED', 'OFFERED', 'ACCEPTED', 'ENROLLED', 'DECLINED');

-- CreateEnum
CREATE TYPE "CustomFieldKind" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'CHOICE');

-- CreateEnum
CREATE TYPE "RemarkKind" AS ENUM ('TEACHER', 'HEAD', 'CONDUCT', 'INTEREST');

-- CreateEnum
CREATE TYPE "EventAudience" AS ENUM ('ALL', 'STAFF', 'GUARDIANS', 'STUDENTS');

-- CreateEnum
CREATE TYPE "WhatsAppDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "termId" TEXT,
    "sequence" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementBatch" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "provider" "GatewayProvider" NOT NULL,
    "filename" TEXT NOT NULL,
    "grossTotal" DECIMAL(12,2) NOT NULL,
    "netTotal" DECIMAL(12,2) NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRow" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "gross" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "status" "SettlementStatus" NOT NULL DEFAULT 'UNMATCHED',
    "intentId" TEXT,
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Applicant" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "levelId" TEXT,
    "guardianName" TEXT NOT NULL,
    "guardianPhone" TEXT NOT NULL,
    "guardianEmail" TEXT,
    "previousSchool" TEXT,
    "notes" TEXT,
    "stage" "ApplicantStage" NOT NULL DEFAULT 'APPLIED',
    "studentId" TEXT,
    "reference" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldDef" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "CustomFieldKind" NOT NULL DEFAULT 'TEXT',
    "options" JSONB,
    "levelId" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomFieldDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentFieldValue" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRequirement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "levelId" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemarkBank" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "kind" "RemarkKind" NOT NULL,
    "text" TEXT NOT NULL,
    "minScore" INTEGER,
    "maxScore" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemarkBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "location" TEXT,
    "audience" "EventAudience" NOT NULL DEFAULT 'ALL',
    "levelId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningResource" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "subjectId" TEXT,
    "levelId" TEXT,
    "classId" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceDownload" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "userId" TEXT,
    "guardianId" TEXT,
    "studentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceDownload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetablePeriod" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsMin" INTEGER NOT NULL,
    "endsMin" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isBreak" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetablePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableSlot" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "subjectId" TEXT,
    "teacherId" TEXT,
    "room" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetableSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "guardianId" TEXT,
    "windowExpiresAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "WhatsAppDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "externalId" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Installment_schoolId_dueDate_idx" ON "Installment"("schoolId", "dueDate");

-- CreateIndex
CREATE INDEX "Installment_schoolId_studentId_idx" ON "Installment"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_invoiceId_sequence_key" ON "Installment"("invoiceId", "sequence");

-- CreateIndex
CREATE INDEX "SettlementBatch_schoolId_createdAt_idx" ON "SettlementBatch"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "SettlementRow_schoolId_status_idx" ON "SettlementRow"("schoolId", "status");

-- CreateIndex
CREATE INDEX "SettlementRow_schoolId_reference_idx" ON "SettlementRow"("schoolId", "reference");

-- CreateIndex
CREATE INDEX "Applicant_schoolId_stage_idx" ON "Applicant"("schoolId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Applicant_schoolId_reference_key" ON "Applicant"("schoolId", "reference");

-- CreateIndex
CREATE INDEX "CustomFieldDef_schoolId_levelId_idx" ON "CustomFieldDef"("schoolId", "levelId");

-- CreateIndex
CREATE INDEX "StudentFieldValue_schoolId_idx" ON "StudentFieldValue"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentFieldValue_studentId_fieldId_key" ON "StudentFieldValue"("studentId", "fieldId");

-- CreateIndex
CREATE INDEX "DocumentRequirement_schoolId_levelId_idx" ON "DocumentRequirement"("schoolId", "levelId");

-- CreateIndex
CREATE INDEX "RemarkBank_schoolId_kind_idx" ON "RemarkBank"("schoolId", "kind");

-- CreateIndex
CREATE INDEX "CalendarEvent_schoolId_startsAt_idx" ON "CalendarEvent"("schoolId", "startsAt");

-- CreateIndex
CREATE INDEX "LearningResource_schoolId_levelId_idx" ON "LearningResource"("schoolId", "levelId");

-- CreateIndex
CREATE INDEX "LearningResource_schoolId_classId_idx" ON "LearningResource"("schoolId", "classId");

-- CreateIndex
CREATE INDEX "ResourceDownload_schoolId_resourceId_idx" ON "ResourceDownload"("schoolId", "resourceId");

-- CreateIndex
CREATE INDEX "TimetablePeriod_schoolId_order_idx" ON "TimetablePeriod"("schoolId", "order");

-- CreateIndex
CREATE INDEX "TimetableSlot_schoolId_teacherId_weekday_idx" ON "TimetableSlot"("schoolId", "teacherId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableSlot_classId_periodId_weekday_key" ON "TimetableSlot"("classId", "periodId", "weekday");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_schoolId_windowExpiresAt_idx" ON "WhatsAppConversation"("schoolId", "windowExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_schoolId_phone_key" ON "WhatsAppConversation"("schoolId", "phone");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_schoolId_conversationId_createdAt_idx" ON "WhatsAppMessage"("schoolId", "conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_schoolId_externalId_key" ON "WhatsAppMessage"("schoolId", "externalId");

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRow" ADD CONSTRAINT "SettlementRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SettlementBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldDef" ADD CONSTRAINT "CustomFieldDef_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFieldValue" ADD CONSTRAINT "StudentFieldValue_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFieldValue" ADD CONSTRAINT "StudentFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomFieldDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequirement" ADD CONSTRAINT "DocumentRequirement_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningResource" ADD CONSTRAINT "LearningResource_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningResource" ADD CONSTRAINT "LearningResource_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningResource" ADD CONSTRAINT "LearningResource_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceDownload" ADD CONSTRAINT "ResourceDownload_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "LearningResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TimetablePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-Level Security for the tables added above.
--
-- Every one of these carries schoolId directly, so the policy is a plain comparison against the
-- per-request setting. A new tenant table without this is invisible to the fence: it would rely
-- on every query remembering its where clause, which is exactly what RLS exists to stop.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Installment', 'SettlementBatch', 'SettlementRow', 'Applicant', 'CustomFieldDef',
    'StudentFieldValue', 'DocumentRequirement', 'RemarkBank', 'CalendarEvent',
    'LearningResource', 'ResourceDownload', 'TimetablePeriod', 'TimetableSlot',
    'WhatsAppConversation', 'WhatsAppMessage'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("schoolId" = app_current_school()) '
      'WITH CHECK ("schoolId" = app_current_school())', t);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eyo_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eyo_app;
  END IF;
END $$;
