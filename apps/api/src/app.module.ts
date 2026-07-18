import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.service';
import { AuthGuard } from './common/auth';
import { AuthModule } from './auth/auth.module';
import { SchoolsModule } from './schools/schools.module';
import { StudentsModule } from './students/students.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AssessmentModule } from './assessment/assessment.module';
import { FeesModule } from './fees/fees.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { SmsModule } from './sms/sms.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AuditModule } from './audit/audit.module';
import { UsersModule } from './users/users.module';
import { GuardianModule } from './guardian/guardian.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    SchoolsModule,
    StudentsModule,
    AttendanceModule,
    AssessmentModule,
    FeesModule,
    DashboardModule,
    AnnouncementsModule,
    SmsModule,
    OnboardingModule,
    AuditModule,
    UsersModule,
    GuardianModule,
    PaymentsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
