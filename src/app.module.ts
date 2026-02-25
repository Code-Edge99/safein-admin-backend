import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';

// Feature Modules
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { WorkTypesModule } from './modules/work-types/work-types.module';
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

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Database
    PrismaModule,

    // Feature Modules
    AuthModule,
    OrganizationsModule,
    EmployeesModule,
    WorkTypesModule,
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
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
