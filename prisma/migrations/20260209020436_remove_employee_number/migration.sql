-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('company', 'site', 'field', 'department', 'team');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'RESIGNED', 'EXCEPTION', 'LEAVE');

-- CreateEnum
CREATE TYPE "DeviceOS" AS ENUM ('Android', 'iOS');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('NORMAL', 'INACTIVE', 'SUSPICIOUS', 'NO_COMM');

-- CreateEnum
CREATE TYPE "DeviceOperationStatus" AS ENUM ('IN_USE', 'LOGGED_OUT', 'LOST', 'REPLACING', 'UNASSIGNED', 'PREVIOUS');

-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('danger', 'normal', 'work', 'safe');

-- CreateEnum
CREATE TYPE "ZoneShape" AS ENUM ('circle', 'polygon');

-- CreateEnum
CREATE TYPE "BehaviorConditionType" AS ENUM ('distance', 'walking', 'walkingSpeed', 'vehicleSpeed', 'composite');

-- CreateEnum
CREATE TYPE "ControlLogType" AS ENUM ('behavior', 'harmful_app');

-- CreateEnum
CREATE TYPE "ControlLogAction" AS ENUM ('blocked', 'allowed');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'SITE_ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'ACTIVATE', 'DEACTIVATE');

-- CreateEnum
CREATE TYPE "LoginStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "parentId" TEXT,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "workTypeId" TEXT,
    "position" VARCHAR(50),
    "role" VARCHAR(100),
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "phone" VARCHAR(20),
    "email" VARCHAR(100),
    "hireDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "deviceId" VARCHAR(50) NOT NULL,
    "employeeId" TEXT,
    "organizationId" TEXT,
    "os" "DeviceOS" NOT NULL,
    "osVersion" VARCHAR(20),
    "model" VARCHAR(50),
    "manufacturer" VARCHAR(50),
    "appVersion" VARCHAR(20),
    "status" "DeviceStatus" NOT NULL DEFAULT 'NORMAL',
    "deviceStatus" "DeviceOperationStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "lastCommunication" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedReason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "lastRefreshed" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_push_tokens" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "lastError" VARCHAR(200),
    "lastChecked" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_locations" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_types" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(200),
    "organizationId" TEXT NOT NULL,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "ZoneType" NOT NULL,
    "shape" "ZoneShape" NOT NULL,
    "coordinates" JSONB NOT NULL,
    "radius" INTEGER,
    "description" VARCHAR(500),
    "groupId" TEXT,
    "organizationId" TEXT NOT NULL,
    "workTypeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_policies" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "startTime" TIME NOT NULL,
    "endTime" TIME NOT NULL,
    "days" TEXT[],
    "organizationId" TEXT NOT NULL,
    "workTypeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "time_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_policy_exclude_periods" (
    "id" TEXT NOT NULL,
    "timePolicyId" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "startTime" TIME NOT NULL,
    "endTime" TIME NOT NULL,

    CONSTRAINT "time_policy_exclude_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavior_conditions" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "BehaviorConditionType" NOT NULL,
    "distanceThreshold" INTEGER,
    "stepsThreshold" INTEGER,
    "speedThreshold" INTEGER,
    "description" VARCHAR(500),
    "organizationId" TEXT NOT NULL,
    "workTypeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "behavior_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harmful_apps" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "packageName" VARCHAR(200) NOT NULL,
    "category" VARCHAR(50),
    "platform" VARCHAR(20) NOT NULL DEFAULT 'android',
    "iconUrl" VARCHAR(500),
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "harmful_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harmful_app_presets" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "organizationId" TEXT NOT NULL,
    "workTypeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "harmful_app_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harmful_app_preset_items" (
    "id" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "harmfulAppId" TEXT NOT NULL,

    CONSTRAINT "harmful_app_preset_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_policies" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "organizationId" TEXT NOT NULL,
    "workTypeId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "control_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_policy_zones" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,

    CONSTRAINT "control_policy_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_policy_time_policies" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "timePolicyId" TEXT NOT NULL,

    CONSTRAINT "control_policy_time_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_policy_behaviors" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "behaviorConditionId" TEXT NOT NULL,

    CONSTRAINT "control_policy_behaviors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_policy_harmful_apps" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,

    CONSTRAINT "control_policy_harmful_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_policy_employees" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,

    CONSTRAINT "control_policy_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_logs" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "policyId" TEXT,
    "zoneId" TEXT,
    "type" "ControlLogType" NOT NULL,
    "action" "ControlLogAction" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "reason" VARCHAR(500),
    "appName" VARCHAR(100),
    "packageName" VARCHAR(200),
    "behaviorDistance" INTEGER,
    "behaviorSteps" INTEGER,
    "behaviorSpeed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "control_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_exclusions" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "reason" VARCHAR(500) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "employee_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20),
    "role" "AdminRole" NOT NULL,
    "organizationId" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_login_history" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "loginTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "status" "LoginStatus" NOT NULL,
    "failReason" VARCHAR(200),

    CONSTRAINT "admin_login_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "resourceType" VARCHAR(50) NOT NULL,
    "resourceId" TEXT,
    "resourceName" VARCHAR(200),
    "organizationId" TEXT,
    "changesBefore" JSONB,
    "changesAfter" JSONB,
    "ipAddress" VARCHAR(45),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_daily_stats" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workTypeId" TEXT,
    "date" DATE NOT NULL,
    "totalBlocks" INTEGER NOT NULL DEFAULT 0,
    "behaviorBlocks" INTEGER NOT NULL DEFAULT 0,
    "harmfulAppBlocks" INTEGER NOT NULL DEFAULT 0,
    "zoneViolations" INTEGER NOT NULL DEFAULT 0,
    "timeViolations" INTEGER NOT NULL DEFAULT 0,
    "topBlockedApp" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_daily_stats" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalEmployees" INTEGER NOT NULL DEFAULT 0,
    "activeDevices" INTEGER NOT NULL DEFAULT 0,
    "totalBlocks" INTEGER NOT NULL DEFAULT 0,
    "behaviorBlocks" INTEGER NOT NULL DEFAULT 0,
    "harmfulAppBlocks" INTEGER NOT NULL DEFAULT 0,
    "complianceRate" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hourly_block_stats" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hour" INTEGER NOT NULL,
    "totalBlocks" INTEGER NOT NULL DEFAULT 0,
    "behaviorBlocks" INTEGER NOT NULL DEFAULT 0,
    "harmfulAppBlocks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hourly_block_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_violation_stats" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "violationCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueEmployees" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zone_violation_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_accounts" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "refreshToken" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_login_history" (
    "id" TEXT NOT NULL,
    "employeeAccountId" TEXT NOT NULL,
    "deviceId" TEXT,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "status" "LoginStatus" NOT NULL,
    "failReason" VARCHAR(200),
    "loginTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_login_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installed_apps" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "packageName" VARCHAR(200) NOT NULL,
    "appName" VARCHAR(200) NOT NULL,
    "version" VARCHAR(50),
    "isSystemApp" BOOLEAN NOT NULL DEFAULT false,
    "harmfulAppId" TEXT,
    "isInstalled" BOOLEAN NOT NULL DEFAULT true,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installed_apps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organizations_parentId_idx" ON "organizations"("parentId");

-- CreateIndex
CREATE INDEX "organizations_type_idx" ON "organizations"("type");

-- CreateIndex
CREATE INDEX "employees_organizationId_idx" ON "employees"("organizationId");

-- CreateIndex
CREATE INDEX "employees_siteId_idx" ON "employees"("siteId");

-- CreateIndex
CREATE INDEX "employees_workTypeId_idx" ON "employees"("workTypeId");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE UNIQUE INDEX "devices_deviceId_key" ON "devices"("deviceId");

-- CreateIndex
CREATE INDEX "devices_employeeId_idx" ON "devices"("employeeId");

-- CreateIndex
CREATE INDEX "devices_organizationId_idx" ON "devices"("organizationId");

-- CreateIndex
CREATE INDEX "devices_status_idx" ON "devices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_deviceId_key" ON "device_tokens"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "device_push_tokens_deviceId_key" ON "device_push_tokens"("deviceId");

-- CreateIndex
CREATE INDEX "device_locations_deviceId_timestamp_idx" ON "device_locations"("deviceId", "timestamp");

-- CreateIndex
CREATE INDEX "work_types_organizationId_idx" ON "work_types"("organizationId");

-- CreateIndex
CREATE INDEX "zones_organizationId_idx" ON "zones"("organizationId");

-- CreateIndex
CREATE INDEX "zones_workTypeId_idx" ON "zones"("workTypeId");

-- CreateIndex
CREATE INDEX "time_policies_organizationId_idx" ON "time_policies"("organizationId");

-- CreateIndex
CREATE INDEX "time_policies_workTypeId_idx" ON "time_policies"("workTypeId");

-- CreateIndex
CREATE INDEX "behavior_conditions_organizationId_idx" ON "behavior_conditions"("organizationId");

-- CreateIndex
CREATE INDEX "behavior_conditions_workTypeId_idx" ON "behavior_conditions"("workTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "harmful_apps_packageName_key" ON "harmful_apps"("packageName");

-- CreateIndex
CREATE INDEX "harmful_app_presets_organizationId_idx" ON "harmful_app_presets"("organizationId");

-- CreateIndex
CREATE INDEX "harmful_app_presets_workTypeId_idx" ON "harmful_app_presets"("workTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "harmful_app_preset_items_presetId_harmfulAppId_key" ON "harmful_app_preset_items"("presetId", "harmfulAppId");

-- CreateIndex
CREATE UNIQUE INDEX "control_policies_workTypeId_key" ON "control_policies"("workTypeId");

-- CreateIndex
CREATE INDEX "control_policies_organizationId_idx" ON "control_policies"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "control_policy_zones_policyId_zoneId_key" ON "control_policy_zones"("policyId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "control_policy_time_policies_policyId_timePolicyId_key" ON "control_policy_time_policies"("policyId", "timePolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "control_policy_behaviors_policyId_behaviorConditionId_key" ON "control_policy_behaviors"("policyId", "behaviorConditionId");

-- CreateIndex
CREATE UNIQUE INDEX "control_policy_harmful_apps_policyId_presetId_key" ON "control_policy_harmful_apps"("policyId", "presetId");

-- CreateIndex
CREATE UNIQUE INDEX "control_policy_employees_policyId_employeeId_key" ON "control_policy_employees"("policyId", "employeeId");

-- CreateIndex
CREATE INDEX "control_logs_employeeId_timestamp_idx" ON "control_logs"("employeeId", "timestamp");

-- CreateIndex
CREATE INDEX "control_logs_deviceId_timestamp_idx" ON "control_logs"("deviceId", "timestamp");

-- CreateIndex
CREATE INDEX "control_logs_timestamp_idx" ON "control_logs"("timestamp");

-- CreateIndex
CREATE INDEX "control_logs_type_idx" ON "control_logs"("type");

-- CreateIndex
CREATE INDEX "employee_exclusions_employeeId_idx" ON "employee_exclusions"("employeeId");

-- CreateIndex
CREATE INDEX "employee_exclusions_isActive_idx" ON "employee_exclusions"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_username_key" ON "accounts"("username");

-- CreateIndex
CREATE INDEX "accounts_role_idx" ON "accounts"("role");

-- CreateIndex
CREATE INDEX "accounts_status_idx" ON "accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_permissionId_key" ON "role_permissions"("role", "permissionId");

-- CreateIndex
CREATE INDEX "admin_login_history_accountId_loginTime_idx" ON "admin_login_history"("accountId", "loginTime");

-- CreateIndex
CREATE INDEX "audit_logs_accountId_timestamp_idx" ON "audit_logs"("accountId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_timestamp_idx" ON "audit_logs"("resourceType", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "employee_daily_stats_date_idx" ON "employee_daily_stats"("date");

-- CreateIndex
CREATE INDEX "employee_daily_stats_organizationId_date_idx" ON "employee_daily_stats"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_daily_stats_employeeId_date_key" ON "employee_daily_stats"("employeeId", "date");

-- CreateIndex
CREATE INDEX "organization_daily_stats_date_idx" ON "organization_daily_stats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "organization_daily_stats_organizationId_date_key" ON "organization_daily_stats"("organizationId", "date");

-- CreateIndex
CREATE INDEX "hourly_block_stats_date_idx" ON "hourly_block_stats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "hourly_block_stats_organizationId_date_hour_key" ON "hourly_block_stats"("organizationId", "date", "hour");

-- CreateIndex
CREATE INDEX "zone_violation_stats_date_idx" ON "zone_violation_stats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "zone_violation_stats_zoneId_date_key" ON "zone_violation_stats"("zoneId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_accounts_employeeId_key" ON "employee_accounts"("employeeId");

-- CreateIndex
CREATE INDEX "employee_login_history_employeeAccountId_loginTime_idx" ON "employee_login_history"("employeeAccountId", "loginTime");

-- CreateIndex
CREATE INDEX "installed_apps_deviceId_idx" ON "installed_apps"("deviceId");

-- CreateIndex
CREATE INDEX "installed_apps_harmfulAppId_idx" ON "installed_apps"("harmfulAppId");

-- CreateIndex
CREATE INDEX "installed_apps_packageName_idx" ON "installed_apps"("packageName");

-- CreateIndex
CREATE UNIQUE INDEX "installed_apps_deviceId_packageName_key" ON "installed_apps"("deviceId", "packageName");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_locations" ADD CONSTRAINT "device_locations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_types" ADD CONSTRAINT "work_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_policies" ADD CONSTRAINT "time_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_policies" ADD CONSTRAINT "time_policies_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_policy_exclude_periods" ADD CONSTRAINT "time_policy_exclude_periods_timePolicyId_fkey" FOREIGN KEY ("timePolicyId") REFERENCES "time_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_conditions" ADD CONSTRAINT "behavior_conditions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_conditions" ADD CONSTRAINT "behavior_conditions_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harmful_app_presets" ADD CONSTRAINT "harmful_app_presets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harmful_app_presets" ADD CONSTRAINT "harmful_app_presets_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harmful_app_preset_items" ADD CONSTRAINT "harmful_app_preset_items_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "harmful_app_presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harmful_app_preset_items" ADD CONSTRAINT "harmful_app_preset_items_harmfulAppId_fkey" FOREIGN KEY ("harmfulAppId") REFERENCES "harmful_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policies" ADD CONSTRAINT "control_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policies" ADD CONSTRAINT "control_policies_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policy_zones" ADD CONSTRAINT "control_policy_zones_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "control_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policy_zones" ADD CONSTRAINT "control_policy_zones_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policy_time_policies" ADD CONSTRAINT "control_policy_time_policies_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "control_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policy_time_policies" ADD CONSTRAINT "control_policy_time_policies_timePolicyId_fkey" FOREIGN KEY ("timePolicyId") REFERENCES "time_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policy_behaviors" ADD CONSTRAINT "control_policy_behaviors_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "control_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policy_behaviors" ADD CONSTRAINT "control_policy_behaviors_behaviorConditionId_fkey" FOREIGN KEY ("behaviorConditionId") REFERENCES "behavior_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policy_harmful_apps" ADD CONSTRAINT "control_policy_harmful_apps_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "control_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policy_harmful_apps" ADD CONSTRAINT "control_policy_harmful_apps_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "harmful_app_presets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policy_employees" ADD CONSTRAINT "control_policy_employees_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "control_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_policy_employees" ADD CONSTRAINT "control_policy_employees_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_logs" ADD CONSTRAINT "control_logs_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_logs" ADD CONSTRAINT "control_logs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_logs" ADD CONSTRAINT "control_logs_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "control_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_logs" ADD CONSTRAINT "control_logs_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_exclusions" ADD CONSTRAINT "employee_exclusions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_login_history" ADD CONSTRAINT "admin_login_history_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_daily_stats" ADD CONSTRAINT "employee_daily_stats_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_daily_stats" ADD CONSTRAINT "employee_daily_stats_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_daily_stats" ADD CONSTRAINT "organization_daily_stats_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_block_stats" ADD CONSTRAINT "hourly_block_stats_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_violation_stats" ADD CONSTRAINT "zone_violation_stats_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_accounts" ADD CONSTRAINT "employee_accounts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_login_history" ADD CONSTRAINT "employee_login_history_employeeAccountId_fkey" FOREIGN KEY ("employeeAccountId") REFERENCES "employee_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installed_apps" ADD CONSTRAINT "installed_apps_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installed_apps" ADD CONSTRAINT "installed_apps_harmfulAppId_fkey" FOREIGN KEY ("harmfulAppId") REFERENCES "harmful_apps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
