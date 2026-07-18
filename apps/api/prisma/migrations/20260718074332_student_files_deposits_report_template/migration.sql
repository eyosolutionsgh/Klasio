-- CreateEnum
CREATE TYPE "ReportTemplate" AS ENUM ('GES', 'MODERN');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "reportTemplate" "ReportTemplate" NOT NULL DEFAULT 'GES';

-- CreateTable
CREATE TABLE "StudentDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankDeposit" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "bankName" TEXT,
    "bankRef" TEXT,
    "depositedAt" TIMESTAMP(3) NOT NULL,
    "proofKey" TEXT,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "note" TEXT,
    "reviewNote" TEXT,
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentDocument_schoolId_studentId_idx" ON "StudentDocument"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "BankDeposit_reference_key" ON "BankDeposit"("reference");

-- CreateIndex
CREATE INDEX "BankDeposit_schoolId_status_idx" ON "BankDeposit"("schoolId", "status");

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDeposit" ADD CONSTRAINT "BankDeposit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
