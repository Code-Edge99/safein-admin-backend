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
import { TbmsModule } from './modules/tbms/tbms.module';
import { IncidentReportsModule } from './modules/incident-reports/incident-reports.module';
import { ReportMetricSettingsModule } from './modules/report-metric-settings/report-metric-settings.module';
import { RequestBoardModule } from './modules/request-board/request-board.module';
import { CommonCodesModule } from './modules/common-codes/common-codes.module';
import { DocumentIssuesModule } from './modules/document-issues/document-issues.module';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { TranslationModule } from './common/translation/translation.module';
import { TranslationsModule } from './modules/translations/translations.module';
import { SystemStorageModule } from './modules/system-storage/system-storage.module';
import { HttpFileLogger } from './common/utils/http-file.logger';

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
    TbmsModule,
    IncidentReportsModule,
    ReportMetricSettingsModule,
    RequestBoardModule,
    CommonCodesModule,
    DocumentIssuesModule,
    TranslationsModule,
    SystemStorageModule,
  ],
  controllers: [],
  providers: [RequestLoggingInterceptor, HttpFileLogger],
})
export class AppModule {}
