-- CreateTable
CREATE TABLE "StudentFeeItem" (
    "studentId" TEXT NOT NULL,
    "feeItemId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentFeeItem_pkey" PRIMARY KEY ("studentId","feeItemId")
);

-- CreateIndex
CREATE INDEX "StudentFeeItem_schoolId_idx" ON "StudentFeeItem"("schoolId");

-- AddForeignKey
ALTER TABLE "StudentFeeItem" ADD CONSTRAINT "StudentFeeItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFeeItem" ADD CONSTRAINT "StudentFeeItem_feeItemId_fkey" FOREIGN KEY ("feeItemId") REFERENCES "FeeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
