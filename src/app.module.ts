import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { createStageConfigLoader } from './common/config/stage.config';

// Feature Modules
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { DevicesModule } from './modules/devices/devices.module';
import { ZonesModule } from './modules/zones/zones.module';
import { TimePoliciesModule } from './modules/time-policies/time-policies.module';
import { ControlPoliciesModule } from './modules/control-policies/control-policies.module';
import { ControlLogsModule } from './modules/control-logs/control-logs.module';
import { BehaviorConditionsModule } from './modules/behavior-conditions/behavior-conditions.module';
import { AllowedAppsModule } from './modules/allowed-apps/allowed-apps.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { LoginHistoryModule } from './modules/login-history/login-history.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { MapsModule } from './modules/maps/maps.module';
import { NoticesModule } from './modules/notices/notices.module';
import { IncidentReportsModule } from './modules/incident-reports/incident-reports.module';
import { ReportMetricSettingsModule } from './modules/report-metric-settings/report-metric-settings.module';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { TranslationModule } from './common/translation/translation.module';
import { TranslationsModule } from './modules/translations/translations.module';

@Module({
  imports: [
    // 단일 .env 파일 로드 → createStageConfigLoader가 KEY_PROD 등을 KEY로 자동 매핑
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [createStageConfigLoader()],
    }),

    // Database
    PrismaModule,
    TranslationModule,

    // Feature Modules
    AuthModule,
    OrganizationsModule,
    EmployeesModule,
    DevicesModule,
    ZonesModule,
    TimePoliciesModule,
    ControlPoliciesModule,
    ControlLogsModule,
    BehaviorConditionsModule,
    AllowedAppsModule,
    AccountsModule,
    AuditLogsModule,
    LoginHistoryModule,
    DashboardModule,
    PermissionsModule,
    MapsModule,
    NoticesModule,
    IncidentReportsModule,
    ReportMetricSettingsModule,
    TranslationsModule,
  ],
  controllers: [],
  providers: [RequestLoggingInterceptor],
})
export class AppModule {}
