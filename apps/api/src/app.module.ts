import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.service';
import { AuthGuard } from './common/auth';
import { TenantInterceptor } from './common/tenant.interceptor';
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
import { PickupModule } from './pickup/pickup.module';
import { StudentPortalModule } from './student-portal/student-portal.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { AdmissionsModule } from './admissions/admissions.module';
import { CalendarModule } from './calendar/calendar.module';
import { ResourcesModule } from './resources/resources.module';
import { TimetableModule } from './timetable/timetable.module';
import { CustomFieldsModule } from './customfields/customfields.module';
import { RemarksModule } from './remarks/remarks.module';
import { ReturnsModule } from './returns/returns.module';
import { BillingModule } from './billing/billing.module';
import { PlatformModule } from './platform/platform.module';
import { RolesModule } from './roles/roles.module';

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
    PickupModule,
    StudentPortalModule,
    ReconciliationModule,
    WhatsAppModule,
    AdmissionsModule,
    CalendarModule,
    ResourcesModule,
    TimetableModule,
    CustomFieldsModule,
    RemarksModule,
    ReturnsModule,
    BillingModule,
    RolesModule,
    PlatformModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
