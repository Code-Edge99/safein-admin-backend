import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureOrganizationInScope } from '../../common/utils/organization-scope.util';
import { decryptLocation } from '../../common/security/location-crypto';
import {
  formatKstDateKey,
  formatKstMonthDay,
  formatKstTimestampString,
  getKstDaysAgoStart,
  getKstMonthStart,
  getKstStartOfDay,
  preferKstTimestamp,
} from '../../common/utils/kst-time.util';
import { findEmployeeByIdentifier, resolveEmployeePrimaryId } from '../../common/utils/employee-identifier.util';
import { buildSiteReportItem, SiteReportTrendPoint } from './dashboard.mapper';
import { ReaggregateDayDto } from './dto/reaggregate-day.dto';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private prisma: PrismaService) {}

  private static readonly COMPLIANCE_WEIGHTS = {
    appControl: 1.0,
    behavior: 1.2,
  } as const;
  private static readonly COMPLIANCE_DAILY_PENALTY = 3;
  private static readonly KST_OFFSET_MS = 9 * 60 * 60 * 1000;

  private parseKstDateInput(dateText: string): Date {
    const raw = String(dateText || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new BadRequestException('date는 YYYY-MM-DD 형식이어야 합니다.');
    }

    const parsed = new Date(`${raw}T00:00:00+09:00`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('date가 유효하지 않습니다.');
    }

    return getKstStartOfDay(parsed);
  }

  private getKstHourFromUtc(value: Date): number {
    return new Date(value.getTime() + DashboardService.KST_OFFSET_MS).getUTCHours();
  }

  private async buildPackageNameToAppNameMap(packageNames: string[]): Promise<Map<string, string>> {
    const uniquePackageNames = Array.from(new Set(packageNames.filter((value) => !!value)));
    if (uniquePackageNames.length === 0) {
      return new Map<string, string>();
    }

    const [allowedApps, installedApps]: Array<Array<{ packageName: string; name?: string; appName?: string }>> = await Promise.all([
      this.prisma.allowedApp.findMany({
        where: { packageName: { in: uniquePackageNames } },
        select: { packageName: true, name: true },
      }),
      this.prisma.installedApp.findMany({
        where: { packageName: { in: uniquePackageNames } },
        select: { packageName: true, appName: true, lastDetectedAt: true },
        orderBy: { lastDetectedAt: 'desc' },
      }),
    ]);

    const packageNameToAppName = new Map<string, string>();
    installedApps.forEach((app) => {
      if (!packageNameToAppName.has(app.packageName) && app.appName) {
        packageNameToAppName.set(app.packageName, app.appName);
      }
    });
    allowedApps.forEach((app) => {
      if (!packageNameToAppName.has(app.packageName) && app.name) {
        packageNameToAppName.set(app.packageName, app.name);
      }
    });

    return packageNameToAppName;
  }

  private resolveControlLogAppLabel(
    log: { packageName?: string | null; appName?: string | null },
    packageNameToAppName: Map<string, string>,
  ): string | null {
    if (log.appName) {
      return log.appName;
    }

    if (log.packageName) {
      return packageNameToAppName.get(log.packageName) || log.packageName;
    }

    return null;
  }

  private summarizeBlockedApps<T extends { employeeId?: string | null; packageName?: string | null; appName?: string | null; type?: string | null; action?: string | null }>(
    logs: T[],
    packageNameToAppName: Map<string, string>,
  ) {
    const employeeAppCounts = new Map<string, Map<string, number>>();

    logs.forEach((log) => {
      if (log.type !== 'app_control' || log.action !== 'blocked' || !log.employeeId) {
        return;
      }

      const appLabel = this.resolveControlLogAppLabel(log, packageNameToAppName);
      if (!appLabel) {
        return;
      }

      const appCounts = employeeAppCounts.get(log.employeeId) || new Map<string, number>();
      appCounts.set(appLabel, (appCounts.get(appLabel) || 0) + 1);
      employeeAppCounts.set(log.employeeId, appCounts);
    });

    const summaries = new Map<string, {
      blockedAppsCount: number;
      topBlockedApp: string;
      topViolationApps: Array<{ name: string; count: number }>;
    }>();

    employeeAppCounts.forEach((appCounts, employeeId) => {
      const sortedApps = Array.from(appCounts.entries())
        .sort((left, right) => {
          if (right[1] !== left[1]) {
            return right[1] - left[1];
          }

          return left[0].localeCompare(right[0], 'ko');
        })
        .map(([name, count]) => ({ name, count }));

      summaries.set(employeeId, {
        blockedAppsCount: appCounts.size,
        topBlockedApp: sortedApps[0]?.name || '-',
        topViolationApps: sortedApps.slice(0, 3),
      });
    });

    return summaries;
  }

  private calculateWeightedComplianceRate(params: {
    activeDays: number;
    appControlBlocks: number;
    behaviorBlocks: number;
    rounded?: boolean;
  }): number {
    const {
      activeDays,
      appControlBlocks,
      behaviorBlocks,
      rounded = true,
    } = params;

    const denominator = Math.max(activeDays, 1);
    const weightedViolationScore =
      appControlBlocks * DashboardService.COMPLIANCE_WEIGHTS.appControl
      + behaviorBlocks * DashboardService.COMPLIANCE_WEIGHTS.behavior;

    const dailyWeightedViolation = weightedViolationScore / denominator;
    const rawRate = Math.max(
      0,
      100 - dailyWeightedViolation * DashboardService.COMPLIANCE_DAILY_PENALTY,
    );

    if (!rounded) {
      return Math.round(rawRate * 10) / 10;
    }

    return Math.round(rawRate);
  }

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    ensureOrganizationInScope(organizationId, scopeOrganizationIds);
  }

  private inScope(scopeOrganizationIds?: string[]): { in: string[] } | undefined {
    if (!scopeOrganizationIds) {
      return undefined;
    }
    return { in: scopeOrganizationIds };
  }

  private buildControlLogOrganizationScopeCondition(
    scopeOrganizationIds?: string[],
    organizationId?: string,
  ): any | undefined {
    if (organizationId) {
      return {
        OR: [
          { organizationId },
          {
            AND: [
              { organizationId: null },
              { device: { organizationId } },
            ],
          },
        ],
      };
    }

    if (!scopeOrganizationIds) {
      return undefined;
    }

    return {
      OR: [
        { organizationId: { in: scopeOrganizationIds } },
        {
          AND: [
            { organizationId: null },
            { device: { organizationId: { in: scopeOrganizationIds } } },
          ],
        },
      ],
    };
  }

  private buildControlLogOrganizationIdsCondition(organizationIds: string[]): any | undefined {
    if (organizationIds.length === 0) {
      return undefined;
    }

    return {
      OR: [
        { organizationId: { in: organizationIds } },
        {
          AND: [
            { organizationId: null },
            { device: { organizationId: { in: organizationIds } } },
          ],
        },
      ],
    };
  }

  private async collectDescendantOrganizationIds(
    rootId: string,
    scopeOrganizationIds?: string[],
  ): Promise<string[]> {
    this.ensureOrganizationInScope(rootId, scopeOrganizationIds);

    const visited = new Set<string>([rootId]);
    let frontier = [rootId];

    while (frontier.length > 0) {
      const children = await this.prisma.organization.findMany({
        where: {
          parentId: { in: frontier },
          isActive: true,
          ...(scopeOrganizationIds ? { id: { in: scopeOrganizationIds } } : {}),
        },
        select: { id: true },
      });

      const nextFrontier: string[] = [];
      for (const child of children) {
        if (!visited.has(child.id)) {
          visited.add(child.id);
          nextFrontier.push(child.id);
        }
      }

      frontier = nextFrontier;
    }

    return Array.from(visited);
  }

  async getStats(scopeOrganizationIds?: string[]) {
    const now = new Date();
    const onlineThreshold = new Date(now.getTime() - 15 * 60 * 1000);
    const todayStart = getKstStartOfDay(now);
    const yesterdayStart = getKstDaysAgoStart(1, now);
    const monthStart = getKstMonthStart(now);
    const previousMonthStart = getKstMonthStart(now, -1);
    const controlLogScopeCondition = this.buildControlLogOrganizationScopeCondition(scopeOrganizationIds);

    const [
      totalEmployees,
      activeEmployees,
      totalDevices,
      activeDevices,
      activePolicies,
      activeZones,
      todayLogs,
      yesterdayLogs,
      onlineEmployees,
      employeesThisMonth,
      employeesLastMonth,
    ] = await Promise.all([
      this.prisma.employee.count({
        where: scopeOrganizationIds
          ? { organizationId: { in: scopeOrganizationIds } }
          : undefined,
      }),
      this.prisma.employee.count({
        where: {
          status: 'ACTIVE',
          ...(scopeOrganizationIds
            ? {
                organizationId: { in: scopeOrganizationIds },
              }
            : {}),
        },
      }),
      this.prisma.device.count({
        where: scopeOrganizationIds
          ? { organizationId: { in: scopeOrganizationIds } }
          : undefined,
      }),
      this.prisma.device.count({
        where: {
          status: 'NORMAL',
          lastCommunication: { gte: onlineThreshold },
          ...(scopeOrganizationIds
            ? {
                organizationId: { in: scopeOrganizationIds },
              }
            : {}),
        },
      }),
      this.prisma.controlPolicy.count({
        where: {
          isActive: true,
          ...(scopeOrganizationIds
            ? {
                organizationId: { in: scopeOrganizationIds },
              }
            : {}),
        },
      }),
      this.prisma.zone.count({
        where: {
          deletedAt: null,
          ...(scopeOrganizationIds
            ? {
                organizationId: { in: scopeOrganizationIds },
              }
            : {}),
        },
      }),
      this.prisma.controlLog.count({
        where: {
          action: 'blocked',
          timestamp: { gte: todayStart },
          ...(controlLogScopeCondition ? { AND: [controlLogScopeCondition] } : {}),
        },
      }),
      this.prisma.controlLog.count({
        where: {
          action: 'blocked',
          timestamp: { gte: yesterdayStart, lt: todayStart },
          ...(controlLogScopeCondition ? { AND: [controlLogScopeCondition] } : {}),
        },
      }),
      this.prisma.device.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { not: null },
          status: 'NORMAL',
          lastCommunication: { gte: onlineThreshold },
          ...(scopeOrganizationIds
            ? {
                organizationId: { in: scopeOrganizationIds },
              }
            : {}),
        },
      }),
        this.prisma.employee.count({
          where: {
            createdAt: { gte: monthStart },
            ...(scopeOrganizationIds
              ? {
                  organizationId: { in: scopeOrganizationIds },
                }
              : {}),
          },
        }),
        this.prisma.employee.count({
          where: {
            createdAt: { gte: previousMonthStart, lt: monthStart },
            ...(scopeOrganizationIds
              ? {
                  organizationId: { in: scopeOrganizationIds },
                }
              : {}),
          },
        }),
    ]);

      const employeeMonthlyGrowthRate =
        employeesLastMonth > 0
          ? Math.round(((employeesThisMonth - employeesLastMonth) / employeesLastMonth) * 100)
          : employeesThisMonth > 0
            ? 100
            : 0;

      const violationChangeRate =
        yesterdayLogs > 0
          ? Math.round(((todayLogs - yesterdayLogs) / yesterdayLogs) * 100)
          : todayLogs > 0
            ? 100
            : 0;

    return {
      totalEmployees,
      activeEmployees,
      totalDevices,
      activeDevices,
      activePolicies,
      criticalZones: activeZones,
      todayViolations: todayLogs,
      yesterdayViolations: yesterdayLogs,
      violationChangeRate,
      onlineEmployees: onlineEmployees.length,
      employeesThisMonth,
      employeeMonthlyGrowthRate,
    };
  }

  async getHourlyData(organizationId?: string, date?: string, scopeOrganizationIds?: string[]) {
    let targetDate: Date;
    if (date) {
      const parsedDate = new Date(date);
      targetDate = Number.isNaN(parsedDate.getTime()) ? getKstStartOfDay(new Date()) : getKstStartOfDay(parsedDate);
    } else {
      // 오늘 데이터가 없으면 어제 데이터를 시도
      targetDate = getKstStartOfDay(new Date());
    }

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    const targetOrganizationIds = organizationId
      ? await this.collectDescendantOrganizationIds(organizationId, scopeOrganizationIds)
      : scopeOrganizationIds;

    const where: any = { date: targetDate };
    const controlLogScopeCondition = targetOrganizationIds
      ? this.buildControlLogOrganizationIdsCondition(targetOrganizationIds)
      : this.buildControlLogOrganizationScopeCondition(scopeOrganizationIds, organizationId);
    if (targetOrganizationIds) {
      where.organizationId = { in: targetOrganizationIds };
    }

    let stats = await this.prisma.hourlyBlockStat.findMany({
      where,
      orderBy: { hour: 'asc' },
    });

    // 오늘 데이터가 없으면 어제 데이터 조회
    if (stats.length === 0 && !date) {
      const yesterday = new Date(targetDate.getTime() - (24 * 60 * 60 * 1000));
      where.date = yesterday;
      stats = await this.prisma.hourlyBlockStat.findMany({
        where,
        orderBy: { hour: 'asc' },
      });
      targetDate = yesterday;
    }

    // 24시간 데이터 구성 (없는 시간대는 0으로)
    const hourlyMap = new Map<number, any>();
    stats.forEach((s) => {
      const existing = hourlyMap.get(s.hour) || { totalBlocks: 0, behaviorBlocks: 0, allowedAppBlocks: 0 };
      hourlyMap.set(s.hour, {
        totalBlocks: existing.totalBlocks + s.totalBlocks,
        behaviorBlocks: existing.behaviorBlocks + s.behaviorBlocks,
        allowedAppBlocks: existing.allowedAppBlocks + s.appControlBlocks,
      });
    });

    if (stats.length === 0) {
      const dayStart = new Date(targetDate);
      const dayEnd = new Date(targetDate);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const logs = await this.prisma.controlLog.findMany({
        where: {
          action: 'blocked',
          timestamp: { gte: dayStart, lt: dayEnd },
          ...(controlLogScopeCondition ? { AND: [controlLogScopeCondition] } : {}),
        },
        select: {
          timestamp: true,
          type: true,
        },
      });

      logs.forEach((log) => {
        const hour = log.timestamp.getHours();
        const existing = hourlyMap.get(hour) || { totalBlocks: 0, behaviorBlocks: 0, allowedAppBlocks: 0 };
        hourlyMap.set(hour, {
          totalBlocks: existing.totalBlocks + 1,
          behaviorBlocks: existing.behaviorBlocks + (log.type === 'behavior' ? 1 : 0),
          allowedAppBlocks: existing.allowedAppBlocks + (log.type === 'app_control' ? 1 : 0),
        });
      });
    }

    const result = [];
    for (let h = 0; h < 24; h++) {
      const data = hourlyMap.get(h) || { totalBlocks: 0, behaviorBlocks: 0, allowedAppBlocks: 0 };
      result.push({
        hour: `${String(h).padStart(2, '0')}:00`,
        차단: data.totalBlocks,
        행동감지: data.behaviorBlocks,
        앱제어: data.allowedAppBlocks,
      });
    }

    return result;
  }

  async getDataFreshness(organizationId?: string, scopeOrganizationIds?: string[]) {
    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    const targetOrganizationIds = organizationId
      ? await this.collectDescendantOrganizationIds(organizationId, scopeOrganizationIds)
      : scopeOrganizationIds;

    const controlLogScopeCondition = targetOrganizationIds
      ? this.buildControlLogOrganizationIdsCondition(targetOrganizationIds)
      : this.buildControlLogOrganizationScopeCondition(scopeOrganizationIds, organizationId);

    const [latestRawLog, latestHourlyStat] = await Promise.all([
      this.prisma.controlLog.findFirst({
        where: controlLogScopeCondition ? { AND: [controlLogScopeCondition] } : undefined,
        orderBy: { timestamp: 'desc' },
        select: {
          timestamp: true,
          timestampKst: true,
        },
      }),
      this.prisma.hourlyBlockStat.findFirst({
        where: targetOrganizationIds
          ? { organizationId: { in: targetOrganizationIds } }
          : undefined,
        orderBy: [{ date: 'desc' }, { hour: 'desc' }, { createdAt: 'desc' }],
        select: {
          date: true,
          hour: true,
        },
      }),
    ]);

    const latestAggregatedAt = latestHourlyStat
      ? new Date(latestHourlyStat.date.getTime() + latestHourlyStat.hour * 60 * 60 * 1000)
      : null;

    const lagMinutes = latestRawLog && latestAggregatedAt
      ? Math.max(0, Math.floor((latestRawLog.timestamp.getTime() - latestAggregatedAt.getTime()) / 60000))
      : null;

    let status: 'no_raw_data' | 'aggregating' | 'healthy' | 'delayed' | 'recovery';
    let statusLabel: string;

    if (!latestRawLog) {
      status = 'no_raw_data';
      statusLabel = '원천 로그 없음';
    } else if (!latestAggregatedAt) {
      status = 'aggregating';
      statusLabel = '초기 집계 중';
    } else if ((lagMinutes ?? 0) <= 5) {
      status = 'healthy';
      statusLabel = '정상';
    } else if ((lagMinutes ?? 0) <= 30) {
      status = 'delayed';
      statusLabel = '집계 지연';
    } else {
      status = 'recovery';
      statusLabel = '보정/복구 필요';
    }

    return {
      sourceOfTruth: 'ControlLog/AuditLog',
      derivedData: 'OrganizationDailyStat/HourlyBlockStat',
      message: '통계는 최신 이벤트 반영 지연 또는 보정 중일 수 있음(원천 로그 우선)',
      sla: {
        systemLogs: '실시간(수초~수분)',
        dashboardStats: '준실시간(1~5분)',
        policyChanges: '실시간',
      },
      status,
      statusLabel,
      aggregationLagMinutes: lagMinutes,
      lastRawEventAt: latestRawLog
        ? (latestRawLog.timestampKst || formatKstTimestampString(latestRawLog.timestamp))
        : null,
      lastAggregatedAt: latestAggregatedAt ? formatKstTimestampString(latestAggregatedAt) : null,
      timezone: 'KST',
    };
  }

  async reaggregateDay(
    dto: ReaggregateDayDto,
    accountId: string | null,
    scopeOrganizationIds?: string[],
  ) {
    const targetDate = this.parseKstDateInput(dto.date);
    const nextDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);

    const targetOrganizationIds = dto.organizationId
      ? await this.collectDescendantOrganizationIds(dto.organizationId, scopeOrganizationIds)
      : scopeOrganizationIds;

    if (!targetOrganizationIds || targetOrganizationIds.length === 0) {
      throw new BadRequestException('재집계 대상 조직이 없습니다. organizationId를 지정하거나 권한 범위를 확인해주세요.');
    }

    const results: any[] = [];

    for (const organizationId of targetOrganizationIds) {
      const controlLogScopeCondition = this.buildControlLogOrganizationIdsCondition([organizationId]);
      const logs = await this.prisma.controlLog.findMany({
        where: {
          timestamp: { gte: targetDate, lt: nextDate },
          ...(controlLogScopeCondition ? { AND: [controlLogScopeCondition] } : {}),
        },
        select: {
          timestamp: true,
          type: true,
          action: true,
        },
      });

      const previousDaily = await this.prisma.organizationDailyStat.findUnique({
        where: {
          organizationId_date: {
            organizationId,
            date: targetDate,
          },
        },
      });

      const previousHourly = await this.prisma.hourlyBlockStat.findMany({
        where: {
          organizationId,
          date: targetDate,
        },
        orderBy: { hour: 'asc' },
      });

      const hourlyMap = new Map<number, {
        totalEvents: number;
        allowedEvents: number;
        totalBlocks: number;
        behaviorBlocks: number;
        appControlBlocks: number;
      }>();

      for (let hour = 0; hour < 24; hour += 1) {
        hourlyMap.set(hour, {
          totalEvents: 0,
          allowedEvents: 0,
          totalBlocks: 0,
          behaviorBlocks: 0,
          appControlBlocks: 0,
        });
      }

      let totalEvents = 0;
      let allowedEvents = 0;
      let totalBlocks = 0;
      let behaviorBlocks = 0;
      let appControlBlocks = 0;

      for (const log of logs) {
        const isBlocked = log.action === 'blocked';
        const isAllowed = log.action === 'allowed';
        const isBehavior = log.type === 'behavior';
        const isAppControl = log.type === 'app_control';

        totalEvents += 1;
        if (isAllowed) {
          allowedEvents += 1;
        }
        if (isBlocked) {
          totalBlocks += 1;
        }
        if (isBlocked && isBehavior) {
          behaviorBlocks += 1;
        }
        if (isBlocked && isAppControl) {
          appControlBlocks += 1;
        }

        const hour = this.getKstHourFromUtc(log.timestamp);
        const bucket = hourlyMap.get(hour)!;
        bucket.totalEvents += 1;
        if (isAllowed) {
          bucket.allowedEvents += 1;
        }
        if (isBlocked) {
          bucket.totalBlocks += 1;
        }
        if (isBlocked && isBehavior) {
          bucket.behaviorBlocks += 1;
        }
        if (isBlocked && isAppControl) {
          bucket.appControlBlocks += 1;
        }
      }

      const [totalEmployees, activeDevices] = await Promise.all([
        this.prisma.employee.count({ where: { organizationId, status: 'ACTIVE' } }),
        this.prisma.device.count({ where: { organizationId, status: 'NORMAL' } }),
      ]);

      // 화면 표시와 동일한 가중치 공식 사용 (단일 날짜 재집계이므로 activeDays=1)
      const activeDays = totalBlocks > 0 || behaviorBlocks > 0 || appControlBlocks > 0 ? 1 : 0;
      const complianceRate = this.calculateWeightedComplianceRate({
        activeDays,
        appControlBlocks,
        behaviorBlocks,
        rounded: false,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.organizationDailyStat.upsert({
          where: {
            organizationId_date: {
              organizationId,
              date: targetDate,
            },
          },
          update: {
            totalEmployees,
            activeDevices,
            totalEvents,
            allowedEvents,
            totalBlocks,
            behaviorBlocks,
            appControlBlocks,
            complianceRate,
          },
          create: {
            organizationId,
            date: targetDate,
            totalEmployees,
            activeDevices,
            totalEvents,
            allowedEvents,
            totalBlocks,
            behaviorBlocks,
            appControlBlocks,
            complianceRate,
          },
        });

        await tx.hourlyBlockStat.deleteMany({
          where: {
            organizationId,
            date: targetDate,
          },
        });

        await tx.hourlyBlockStat.createMany({
          data: Array.from(hourlyMap.entries()).map(([hour, value]) => ({
            organizationId,
            date: targetDate,
            hour,
            totalEvents: value.totalEvents,
            allowedEvents: value.allowedEvents,
            totalBlocks: value.totalBlocks,
            behaviorBlocks: value.behaviorBlocks,
            appControlBlocks: value.appControlBlocks,
          })),
        });

        await tx.auditLog.create({
          data: {
            accountId,
            organizationId,
            action: AuditAction.UPDATE,
            resourceType: 'stats_reaggregation',
            resourceId: `${organizationId}:${formatKstDateKey(targetDate)}`,
            resourceName: '조직/일자 통계 재집계',
            changesBefore: {
              daily: previousDaily
                ? {
                    totalEvents: previousDaily.totalEvents,
                    allowedEvents: previousDaily.allowedEvents,
                    totalBlocks: previousDaily.totalBlocks,
                    behaviorBlocks: previousDaily.behaviorBlocks,
                    appControlBlocks: previousDaily.appControlBlocks,
                    complianceRate: previousDaily.complianceRate,
                  }
                : null,
              hourlyTotalBlocks: previousHourly.reduce((sum, row) => sum + row.totalBlocks, 0),
            },
            changesAfter: {
              daily: {
                totalEvents,
                allowedEvents,
                totalBlocks,
                behaviorBlocks,
                appControlBlocks,
                complianceRate,
              },
              hourlyTotalBlocks: Array.from(hourlyMap.values()).reduce((sum, row) => sum + row.totalBlocks, 0),
              meta: {
                reaggregatedAt: new Date().toISOString(),
                timezone: 'KST',
                sourceOfTruth: 'ControlLog',
              },
            },
          },
        });
      });

      results.push({
        organizationId,
        date: formatKstDateKey(targetDate),
        totalEvents,
        totalBlocks,
        allowedEvents,
        behaviorBlocks,
        appControlBlocks,
        complianceRate,
      });
    }

    this.logger.log(
      `통계 재집계 완료(date=${dto.date}, organizations=${results.length})`,
    );

    return {
      success: true,
      sourceOfTruth: 'ControlLog',
      derivedTargets: ['OrganizationDailyStat', 'HourlyBlockStat'],
      date: dto.date,
      results,
    };
  }

  async getZoneViolationData(startDate?: string, endDate?: string, scopeOrganizationIds?: string[]) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 7 * 86400000);

    const stats = await this.prisma.zoneViolationStat.findMany({
      where: {
        date: { gte: start, lte: end },
        ...(scopeOrganizationIds
          ? {
              zone: {
                organizationId: { in: scopeOrganizationIds },
              },
            }
          : {}),
      },
      include: {
        zone: { select: { id: true, name: true, type: true } },
      },
    });

    const uniqueByZoneEmployee = await this.prisma.controlLog.groupBy({
      by: ['zoneId', 'employeeId'],
      where: {
        action: 'blocked',
        zoneId: { not: null },
        timestamp: { gte: start, lte: end },
        ...(scopeOrganizationIds
          ? {
              employee: {
                organizationId: { in: scopeOrganizationIds },
              },
            }
          : {}),
      },
    });

    const uniqueEmployeeCountByZone = new Map<string, number>();
    uniqueByZoneEmployee.forEach((item) => {
      if (!item.zoneId) return;
      uniqueEmployeeCountByZone.set(
        item.zoneId,
        (uniqueEmployeeCountByZone.get(item.zoneId) || 0) + 1,
      );
    });

    const zoneMap = new Map<string, { name: string; type: string; count: number; employees: number }>();
    stats.forEach((s) => {
      const key = s.zoneId;
      const existing = zoneMap.get(key) || {
        name: s.zone?.name || '',
        type: s.zone?.type || '',
        count: 0,
        employees: 0,
      };
      zoneMap.set(key, {
        name: existing.name,
        type: existing.type,
        count: existing.count + s.violationCount,
        employees: uniqueEmployeeCountByZone.get(key) || 0,
      });
    });

    if (zoneMap.size === 0) {
      const logs = await this.prisma.controlLog.findMany({
        where: {
          action: 'blocked',
          zoneId: { not: null },
          timestamp: { gte: start, lte: end },
          ...(scopeOrganizationIds
            ? {
                employee: {
                  organizationId: { in: scopeOrganizationIds },
                },
              }
            : {}),
        },
        include: {
          zone: { select: { id: true, name: true, type: true } },
        },
      });

      logs.forEach((log) => {
        if (!log.zoneId || !log.zone) return;
        const key = log.zoneId;
        const existing = zoneMap.get(key) || {
          name: log.zone.name,
          type: log.zone.type,
          count: 0,
          employees: 0,
        };

        zoneMap.set(key, {
          name: existing.name,
          type: existing.type,
          count: existing.count + 1,
          employees: uniqueEmployeeCountByZone.get(key) || 0,
        });
      });
    }

    const severityMap: Record<string, string> = {
      danger: '위험',
      normal: '일반',
      work: '작업',
      safe: '안전',
    };

    const colorMap: Record<string, string> = {
      danger: '#ef4444',
      normal: '#3b82f6',
      work: '#f59e0b',
      safe: '#22c55e',
    };

    return Array.from(zoneMap.entries()).map(([, data]) => ({
      name: data.name,
      value: data.count,
      color: colorMap[data.type] || '#6b7280',
      severity: severityMap[data.type] || '일반',
      uniqueEmployees: data.employees,
    }));
  }

  async getOrganizationDailyStats(
    organizationId?: string,
    days = 30,
    scopeOrganizationIds?: string[],
  ) {
    const startDate = getKstDaysAgoStart(days);

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    const where: any = { date: { gte: startDate } };
    if (organizationId) {
      where.organizationId = organizationId;
    } else if (scopeOrganizationIds) {
      where.organizationId = { in: scopeOrganizationIds };
    }

    return this.prisma.organizationDailyStat.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async getEmployeeDailyStats(filter: {
    employeeId?: string;
    organizationId?: string;
    days?: number;
    page?: number;
    limit?: number;
    scopeOrganizationIds?: string[];
  }) {
    const days = filter.days || 7;
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const startDate = getKstDaysAgoStart(days);

    this.ensureOrganizationInScope(filter.organizationId, filter.scopeOrganizationIds);

    const employeeWhere: any = {};
    if (filter.employeeId) {
      const resolvedEmployeeId = await resolveEmployeePrimaryId(this.prisma, filter.employeeId);
      employeeWhere.id = resolvedEmployeeId || '__missing_employee__';
    }
    if (filter.organizationId) employeeWhere.organizationId = filter.organizationId;
    else if (filter.scopeOrganizationIds) employeeWhere.organizationId = { in: filter.scopeOrganizationIds };

    const employees = await this.prisma.employee.findMany({
      where: employeeWhere,
      select: {
        id: true,
        referenceId: true,
        name: true,
        organizationId: true,
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    } as any);

    if (employees.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    const employeeIds = employees.map((employee) => employee.id);

    const rawStats = await this.prisma.employeeDailyStat.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: startDate },
      },
      orderBy: { date: 'desc' },
    });

    const appControlLogs = await this.prisma.controlLog.findMany({
      where: {
        employeeId: { in: employeeIds },
        timestamp: { gte: startDate },
        type: 'app_control',
        action: 'blocked',
      },
      select: {
        employeeId: true,
        packageName: true,
        appName: true,
        type: true,
        action: true,
      },
    });

    const packageNameToAppName = await this.buildPackageNameToAppNameMap(
      appControlLogs
        .map((log) => log.packageName)
        .filter((name): name is string => !!name),
    );

    const blockedAppSummaries = this.summarizeBlockedApps(appControlLogs, packageNameToAppName);

    const empMap = new Map<string, any>();
    employees.forEach((employee: any) => {
      empMap.set(employee.id, {
        id: employee.referenceId || employee.id,
        employeeId: employee.id,
        employeeName: employee.name || '',
        organizationId: employee.organizationId || '',
        organizationName: employee.organization?.name || '',
        workType: employee.workType?.name || '',
        totalBlocks: 0,
        totalEvents: 0,
        allowedEvents: 0,
        behaviorBlocks: 0,
        allowedAppBlocks: 0,
        zoneViolations: 0,
        dailyStats: [],
      });
    });

    rawStats.forEach((stat) => {
      const existing = empMap.get(stat.employeeId);
      if (!existing) return;

      const statTotalEvents = (stat as any).totalEvents ?? stat.totalBlocks;
      const statAllowedEvents = (stat as any).allowedEvents ?? 0;

      existing.totalBlocks += stat.totalBlocks;
      existing.totalEvents += statTotalEvents;
      existing.allowedEvents += statAllowedEvents;
      existing.behaviorBlocks += stat.behaviorBlocks;
      existing.allowedAppBlocks += stat.appControlBlocks;
      existing.zoneViolations += stat.zoneViolations;
      existing.dailyStats.push(stat);
    });

    const aggregated = Array.from(empMap.values()).sort((a, b) => {
      if (b.totalBlocks !== a.totalBlocks) {
        return b.totalBlocks - a.totalBlocks;
      }
      return a.employeeName.localeCompare(b.employeeName);
    });

    const total = aggregated.length;
    // 상세 페이지와 동일하게 실제 날짜 기준으로 7일/14일 범위 계산
    const now7Ago = getKstDaysAgoStart(7);
    const now14Ago = getKstDaysAgoStart(14);
    const paged = aggregated.slice(skip, skip + limit).map((emp) => {
      const recentStats = emp.dailyStats.filter((s: any) => s.date >= now7Ago);
      const olderStats = emp.dailyStats.filter((s: any) => s.date >= now14Ago && s.date < now7Ago);
      const recentTotal = recentStats.reduce((sum: number, s: any) => sum + s.totalBlocks, 0);
      const olderTotal = olderStats.reduce((sum: number, s: any) => sum + s.totalBlocks, 0);

      let trend = 'stable';
      if (recentTotal > olderTotal * 1.2) trend = 'up';
      else if (recentTotal < olderTotal * 0.8) trend = 'down';

      const activeDays = emp.dailyStats.filter((stat: any) => {
        const statTotalEvents = (stat as any).totalEvents ?? stat.totalBlocks;
        return (
          statTotalEvents > 0
          || stat.totalBlocks > 0
          || stat.behaviorBlocks > 0
          || stat.appControlBlocks > 0
          || stat.zoneViolations > 0
        );
      }).length;

      const complianceRate = this.calculateWeightedComplianceRate({
        activeDays,
        appControlBlocks: emp.allowedAppBlocks,
        behaviorBlocks: emp.behaviorBlocks,
      });

      let riskLevel = '낮음';
      if (emp.totalBlocks > 20 || emp.zoneViolations > 5 || complianceRate < 60) riskLevel = '높음';
      else if (emp.totalBlocks > 10 || emp.zoneViolations > 2 || complianceRate < 80) riskLevel = '보통';

      const blockedAppSummary = blockedAppSummaries.get(emp.employeeId);

      return {
        id: emp.id || emp.employeeId,
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        organizationId: emp.organizationId,
        organizationName: emp.organizationName,
        workType: emp.workType,
        totalBlocks: emp.totalBlocks,
        last7DaysBlocks: recentTotal,
        trend,
        blockedAppsCount: blockedAppSummary?.blockedAppsCount || 0,
        topBlockedApp: blockedAppSummary?.topBlockedApp || '-',
        complianceRate,
        riskLevel,
        lastViolation: emp.dailyStats[0]?.date || null,
        zoneViolations: emp.zoneViolations,
      };
    });

    return {
      data: paged,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * 직원 리포트 상세 — Employee + ControlLog + EmployeeDailyStat 기반
   * 직원이 존재하기만 하면 항상 전체 구조를 반환 (데이터 없으면 0값)
   */
  async getEmployeeReportDetail(employeeId: string, scopeOrganizationIds?: string[]) {
    // 1. 직원 기본 정보 (항상 존재해야 상세페이지 표시)
    const employee = await findEmployeeByIdentifier(this.prisma, employeeId, {
      include: {
        organization: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
      },
    });

    if (!employee) return null;

    this.ensureOrganizationInScope(employee.organizationId, scopeOrganizationIds);

    const now = new Date();
    const startDate30 = getKstDaysAgoStart(30, now);

    // 2. 일별 통계 (EmployeeDailyStat, 30일)
    const dailyStats = await this.prisma.employeeDailyStat.findMany({
      where: { employeeId: employee.id, date: { gte: startDate30 } },
      orderBy: { date: 'asc' },
    });

    // 3. 제어 로그 (ControlLog, 30일) — 실제 이벤트 데이터
    const controlLogs: any[] = await this.prisma.controlLog.findMany({
      where: { employeeId: employee.id, timestamp: { gte: startDate30 } },
      include: {
        zone: { select: { id: true, name: true, type: true } },
        policy: { select: { id: true, name: true } },
      },
      orderBy: { timestamp: 'desc' },
    });

    const packageNameToAppName = await this.buildPackageNameToAppNameMap(
      controlLogs
        .map((log) => log.packageName)
        .filter((packageName): packageName is string => !!packageName),
    );

    const [zoneVisitSessions, workSessions, appUsageSessions]: [any[], any[], any[]] = await Promise.all([
      this.prisma.zoneVisitSession.findMany({
        where: {
          employeeId: employee.id,
          enteredAt: { gte: startDate30 },
        },
        include: {
          zone: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.workSession.findMany({
        where: {
          employeeId: employee.id,
          startedAt: { gte: startDate30 },
          endedAt: { not: null },
        },
        select: {
          id: true,
          startedAt: true,
          startedAtKst: true,
          endedAt: true,
          endedAtKst: true,
          durationSeconds: true,
        },
      } as any),
      this.prisma.appUsageSession.findMany({
        where: {
          employeeId: employee.id,
          startedAt: { gte: startDate30 },
        },
        select: {
          id: true,
          packageName: true,
          appName: true,
          startedAt: true,
          startedAtKst: true,
          endedAt: true,
          endedAtKst: true,
        },
      } as any),
    ]);

    const appliedPolicy = await this.resolveAppliedPolicyForEmployee(
      employee.id,
      employee.organizationId,
      employee.workTypeId,
    );

    // ── 집계: 통계 ──
    const totalEvents = dailyStats.reduce((s, d) => s + ((d as any).totalEvents ?? d.totalBlocks), 0);
    const totalBlocks = dailyStats.reduce((s, d) => s + d.totalBlocks, 0);
    const behaviorBlocks = dailyStats.reduce((s, d) => s + d.behaviorBlocks, 0);
    const appControlBlocks = dailyStats.reduce((s, d) => s + d.appControlBlocks, 0);
    const zoneViolations = dailyStats.reduce((s, d) => s + d.zoneViolations, 0);
    const activeDays = dailyStats.filter((stat) => {
      const statTotalEvents = (stat as any).totalEvents ?? stat.totalBlocks;
      return (
        statTotalEvents > 0
        || stat.totalBlocks > 0
        || stat.behaviorBlocks > 0
        || stat.appControlBlocks > 0
        || stat.zoneViolations > 0
      );
    }).length;

    // 최근 7일 vs 이전 7일 비교
    const day7Ago = getKstDaysAgoStart(7, now);
    const day14Ago = getKstDaysAgoStart(14, now);

    const recentStats = dailyStats.filter((s) => s.date >= day7Ago);
    const olderStats = dailyStats.filter((s) => s.date >= day14Ago && s.date < day7Ago);
    const recentTotal = recentStats.reduce((s, d) => s + d.totalBlocks, 0);
    const olderTotal = olderStats.reduce((s, d) => s + d.totalBlocks, 0);

    let trend = 'stable';
    if (recentTotal > olderTotal * 1.2) trend = 'up';
    else if (recentTotal < olderTotal * 0.8) trend = 'down';

    const complianceRate = this.calculateWeightedComplianceRate({
      activeDays,
      appControlBlocks,
      behaviorBlocks,
    });

    let riskLevel = '낮음';
    if (totalBlocks > 20 || zoneViolations > 5 || complianceRate < 60) riskLevel = '높음';
    else if (totalBlocks > 10 || zoneViolations > 2 || complianceRate < 80) riskLevel = '보통';

    const weeklyIncreaseRate = olderTotal > 0
      ? Math.round(((recentTotal - olderTotal) / olderTotal) * 100)
      : 0;

    // ── 인사이트: 앱별 위반 Top 3 (ControlLog 기반) ──
    const blockedAppSummary = this.summarizeBlockedApps(
      controlLogs.map((log) => ({
        employeeId: employee.id,
        packageName: log.packageName,
        appName: log.appName,
        type: log.type,
        action: log.action,
      })),
      packageNameToAppName,
    ).get(employee.id);

    const topViolationApps = blockedAppSummary?.topViolationApps || [];
    const uniqueAppCount = blockedAppSummary?.blockedAppsCount || 0;
    const topBlockedApp = blockedAppSummary?.topBlockedApp || '-';

    const zoneCounts = new Map<string, { name: string; count: number }>();
    zoneVisitSessions.forEach((session) => {
      if (!session.zone) return;
      const existing = zoneCounts.get(session.zone.id) || { name: session.zone.name, count: 0 };
      zoneCounts.set(session.zone.id, {
        name: existing.name,
        count: existing.count + 1,
      });
    });
    const topRestrictedZones = Array.from(zoneCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // ── 인사이트: 시간대별 패턴 (ControlLog 기반) ──
    const hourCounts = new Map<number, number>();
    controlLogs.forEach((l) => {
      const h = l.timestamp.getHours();
      hourCounts.set(h, (hourCounts.get(h) || 0) + 1);
    });
    let peakBlockHour = 0;
    let peakBlockCount = 0;
    hourCounts.forEach((count, hour) => {
      if (count > peakBlockCount) {
        peakBlockCount = count;
        peakBlockHour = hour;
      }
    });

    const blockedLogs = controlLogs.filter((l) => l.action === 'blocked');
    const totalLogCount = blockedLogs.length || 1;
    const morningLogs = blockedLogs.filter((l) => {
      const h = l.timestamp.getHours();
      return h >= 8 && h <= 10;
    }).length;
    const eveningLogs = blockedLogs.filter((l) => {
      const h = l.timestamp.getHours();
      return h >= 16 && h <= 18;
    }).length;
    const offHoursActivity = blockedLogs.filter((l) => {
      const h = l.timestamp.getHours();
      return h < 7 || h > 19;
    }).length;

    const blockedLogsAsc = [...blockedLogs].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    let consecutiveBlocks = 0;
    let currentStreak = 0;
    for (let i = 0; i < blockedLogsAsc.length; i++) {
      if (i === 0) {
        currentStreak = 1;
      } else {
        const diffMinutes =
          (blockedLogsAsc[i].timestamp.getTime() - blockedLogsAsc[i - 1].timestamp.getTime()) /
          60000;
        currentStreak = diffMinutes <= 10 ? currentStreak + 1 : 1;
      }
      if (currentStreak > consecutiveBlocks) {
        consecutiveBlocks = currentStreak;
      }
    }

    const closedRestrictedZoneSessions = zoneVisitSessions.filter((session) => !!session.exitedAt);
    const avgStayTime =
      closedRestrictedZoneSessions.length > 0
        ? Math.round(
            closedRestrictedZoneSessions.reduce(
              (sum, session) => {
                const durationSeconds = session.durationSeconds
                  ?? Math.max(
                    0,
                    Math.floor((session.exitedAt!.getTime() - session.enteredAt.getTime()) / 1000),
                  );
                return sum + Math.max(0, durationSeconds / 60);
              },
              0,
            ) / closedRestrictedZoneSessions.length,
          )
        : 0;
    const longStayInRestrictedZone = closedRestrictedZoneSessions.filter(
      (session) => {
        const durationSeconds = session.durationSeconds
          ?? Math.max(
            0,
            Math.floor((session.exitedAt!.getTime() - session.enteredAt.getTime()) / 1000),
          );
        return durationSeconds >= 30 * 60;
      },
    ).length;

    const locationLogs = await this.prisma.deviceLocation.findMany({
      where: {
        device: { employeeId: employee.id },
        timestamp: { gte: startDate30 },
      },
      select: { timestamp: true },
      orderBy: { timestamp: 'asc' },
    });

    const dayRangeMap = new Map<string, { min: number; max: number }>();
    locationLogs.forEach((entry) => {
      const key = formatKstDateKey(entry.timestamp);
      const timestamp = entry.timestamp.getTime();
      const existing = dayRangeMap.get(key);
      if (!existing) {
        dayRangeMap.set(key, { min: timestamp, max: timestamp });
        return;
      }
      if (timestamp < existing.min) existing.min = timestamp;
      if (timestamp > existing.max) existing.max = timestamp;
    });

    const dailyHours = Array.from(dayRangeMap.values())
      .map((range) => (range.max - range.min) / 3600000)
      .filter((hours) => hours > 0)
      .map((hours) => Math.min(hours, 16));
    const avgWorkHoursFromSession =
      workSessions.length > 0
        ? Math.round(
            (workSessions.reduce((sum, item) => sum + ((item.durationSeconds || 0) / 3600), 0) /
              workSessions.length) *
              10,
          ) / 10
        : 0;

    const avgWorkHours =
      avgWorkHoursFromSession > 0
        ? avgWorkHoursFromSession
        : dailyHours.length > 0
          ? Math.round((dailyHours.reduce((sum, value) => sum + value, 0) / dailyHours.length) * 10) / 10
          : 0;

    // ── 비교 분석: 근무유형 평균 / 현장 평균 대비 ──
    let vsWorkTypeAvg = 0;
    let vsSiteAvg = 0;
    if (employee.workTypeId) {
      const peerWtStats = await this.prisma.employeeDailyStat.aggregate({
        where: {
          workTypeId: employee.workTypeId,
          date: { gte: startDate30 },
          employeeId: { not: employee.id },
        },
        _avg: { totalBlocks: true },
        _count: { employeeId: true },
      });
      const peerWtAvg = peerWtStats._avg.totalBlocks || 0;
      if (peerWtAvg > 0) {
        vsWorkTypeAvg = Math.round(((totalBlocks / 30 - peerWtAvg) / peerWtAvg) * 100);
      }
    }
    const peerSiteStats = await this.prisma.employeeDailyStat.aggregate({
      where: {
        organizationId: employee.organizationId,
        date: { gte: startDate30 },
        employeeId: { not: employee.id },
      },
      _avg: { totalBlocks: true },
    });
    const peerSiteAvg = peerSiteStats._avg.totalBlocks || 0;
    if (peerSiteAvg > 0) {
      vsSiteAvg = Math.round(((totalBlocks / 30 - peerSiteAvg) / peerSiteAvg) * 100);
    }

    // ── 추이 데이터 (일별) ──
    const trendData = dailyStats.map((s) => ({
      date: formatKstMonthDay(s.date),
      앱제어: s.appControlBlocks,
      행동차단: s.behaviorBlocks,
    }));

    // ── 발생 이력 (ControlLog 최근 50건) ──
    const violationHistory = controlLogs.slice(0, 50).map((l) => {
      const location = decryptLocation(l);

      return {
        id: l.id,
        type: l.type === 'app_control' ? '앱 제어 위반' : '행동 감지',
        action: l.action === 'blocked' ? '차단' : '허용',
        timestamp: preferKstTimestamp(l.timestampKst, l.timestamp),
        zoneId: l.zone?.id || l.zoneId || null,
        zoneName: l.zone?.name || null,
        location:
          l.zone?.name
          || (location ? { lat: location.latitude, lng: location.longitude } : null)
          || (l.zone?.id || l.zoneId ? `구역 ID: ${l.zone?.id || l.zoneId}` : null),
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        appName: l.appName || (l.packageName ? packageNameToAppName.get(l.packageName) || l.packageName : null),
        description:
          l.reason ||
          (l.type === 'app_control'
            ? `${l.appName || (l.packageName ? packageNameToAppName.get(l.packageName) || l.packageName : '앱')} 사용 감지`
            : '행동 패턴 감지'),
      };
    });

    const recentActivity = [
      ...controlLogs.map((log) => ({
        id: `control-${log.id}`,
        timestamp: preferKstTimestamp(log.timestampKst, log.timestamp),
        actionLabel: log.action === 'blocked' ? '위반 차단' : '정책 허용',
        category: 'control',
        zoneId: log.zone?.id || log.zoneId || null,
        zoneName: log.zone?.name || null,
        description:
          log.reason ||
          (log.type === 'app_control'
            ? `${log.appName || (log.packageName ? packageNameToAppName.get(log.packageName) || log.packageName : '앱')} 사용 감지`
            : '행동 패턴 감지'),
      })),
      ...zoneVisitSessions.flatMap((session) => {
        const events: Array<any> = [
          {
            id: `zone-enter-${session.id}`,
            timestamp: preferKstTimestamp(session.enteredAtKst, session.enteredAt),
            actionLabel: '구역 진입',
            category: 'zone',
            description: `${session.zone?.name || '미지정'} 진입`,
          },
        ];

        if (session.exitedAt) {
          events.push({
            id: `zone-exit-${session.id}`,
            timestamp: preferKstTimestamp(session.exitedAtKst, session.exitedAt),
            actionLabel: '구역 이탈',
            category: 'zone',
            description: `${session.zone?.name || '미지정'} 이탈`,
          });
        }

        return events;
      }),
      ...workSessions.flatMap((session: any, index: number) => {
        const events: Array<any> = [
          {
            id: `work-start-${index}-${session.startedAt?.toISOString?.() || index}`,
            timestamp: preferKstTimestamp(session.startedAtKst, session.startedAt),
            actionLabel: '근무 시작',
            category: 'work',
            description: '근무 세션 시작',
          },
        ];

        if (session.endedAt) {
          events.push({
            id: `work-end-${index}-${session.endedAt.toISOString()}`,
            timestamp: preferKstTimestamp(session.endedAtKst, session.endedAt),
            actionLabel: '근무 종료',
            category: 'work',
            description: '근무 세션 종료',
          });
        }

        return events;
      }),
      ...appUsageSessions.flatMap((session) => {
        const appLabel = session.appName || session.packageName;
        const events: Array<any> = [
          {
            id: `app-foreground-${session.id}`,
            timestamp: preferKstTimestamp(session.startedAtKst, session.startedAt),
            actionLabel: '앱 전경 진입',
            category: 'app',
            description: `${appLabel} 실행`,
          },
        ];

        if (session.endedAt) {
          events.push({
            id: `app-background-${session.id}`,
            timestamp: preferKstTimestamp(session.endedAtKst, session.endedAt),
            actionLabel: '앱 종료/백그라운드',
            category: 'app',
            description: `${appLabel} 종료`,
          });
        }

        return events;
      }),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 50);

    return {
      id: employee.referenceId || employee.id,
      employeeId: employee.id,
      employeeName: employee.name,
      organizationId: employee.organizationId,
      organizationName: employee.organization?.name || '',
      workType: employee.workType?.name || '-',
      period: '최근 30일',
      avgWorkHours,

      totalBlocks,
      last7DaysBlocks: recentTotal,
      trend,
      blockedAppsCount: uniqueAppCount,
      topBlockedApp,
      complianceRate,
      riskLevel,
      zoneViolations,
      lastViolation: preferKstTimestamp(controlLogs[0]?.timestampKst, controlLogs[0]?.timestamp) || null,

      insights: {
        topViolationApps,
        restrictedZoneEntries: zoneVisitSessions.length,
        avgStayTime,
        topRestrictedZones,
        peakBlockTime:
          controlLogs.length > 0
            ? `${String(peakBlockHour).padStart(2, '0')}:00`
            : '해당 없음',
        morningBlockRate: Math.round((morningLogs / totalLogCount) * 100),
        eveningBlockRate: Math.round((eveningLogs / totalLogCount) * 100),
        weeklyIncreaseRate,
        consecutiveBlocks,
        vsWorkTypeAvg,
        vsSiteAvg,
        offHoursActivity,
        longStayInRestrictedZone,
      },

      trendData,
      violationHistory,
      recentActivity,
      appliedPolicy,
    };
  }

  private async resolveAppliedPolicyForEmployee(
    employeeId: string,
    organizationId: string,
    workTypeId?: string | null,
  ) {
    const [assignedPolicies, workTypePolicy] = await Promise.all([
      this.prisma.controlPolicyEmployee.findMany({
        where: {
          employeeId,
          policy: {
            isActive: true,
            organizationId,
          },
        },
        include: {
          policy: {
            include: {
              zones: {
                include: {
                  zone: { select: { id: true, name: true, type: true, description: true, deletedAt: true } },
                },
              },
              timePolicies: {
                include: {
                  timePolicy: {
                    select: { id: true, name: true, startTime: true, endTime: true, days: true },
                  },
                },
              },
              behaviors: {
                include: {
                  behaviorCondition: {
                    select: { id: true, name: true, description: true },
                  },
                },
              },
            },
          },
        },
      }),
      workTypeId
        ? this.prisma.controlPolicy.findFirst({
            where: {
              organizationId,
              workTypeId,
              isActive: true,
            },
            include: {
              zones: {
                include: {
                  zone: { select: { id: true, name: true, type: true, description: true, deletedAt: true } },
                },
              },
              timePolicies: {
                include: {
                  timePolicy: {
                    select: { id: true, name: true, startTime: true, endTime: true, days: true },
                  },
                },
              },
              behaviors: {
                include: {
                  behaviorCondition: {
                    select: { id: true, name: true, description: true },
                  },
                },
              },
            },
          })
        : Promise.resolve(null),
    ]);

    const assignedPolicyIds = new Set(assignedPolicies.map((item) => item.policyId));
    const mergedPolicies = [
      ...(assignedPolicies as Array<{ policy: any }>).map((item) => item.policy),
      ...(workTypePolicy ? [workTypePolicy] : []),
    ];

    const uniquePolicies = Array.from(new Map(mergedPolicies.map((policy: any) => [policy.id, policy])).values());
    if (uniquePolicies.length === 0) {
      return null;
    }

    uniquePolicies.sort((a: any, b: any) => {
      const priorityDiff = (a.priority ?? 9999) - (b.priority ?? 9999);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const selectedPolicy: any = uniquePolicies[0];

    return {
      id: selectedPolicy.id,
      name: selectedPolicy.name,
      description: selectedPolicy.description || '',
      isActive: !!selectedPolicy.isActive,
      priority: selectedPolicy.priority,
      source: assignedPolicyIds.has(selectedPolicy.id) ? 'EMPLOYEE' : 'WORK_TYPE',
      timePolicies: (selectedPolicy.timePolicies || []).map((item: any) => ({
        ...item.timePolicy,
        startTime: this.formatPolicyTime(item.timePolicy?.startTime),
        endTime: this.formatPolicyTime(item.timePolicy?.endTime),
      })),
      zones: (selectedPolicy.zones || [])
        .map((item: any) => item.zone)
        .filter((zone: any) => zone?.isActive && !zone?.deletedAt),
      behaviorConditions: (selectedPolicy.behaviors || []).map((item: any) => item.behaviorCondition),
    };
  }

  private formatPolicyTime(value: Date | string | null | undefined): string {
    if (!value) {
      return '';
    }

    if (typeof value === 'string') {
      const timeOnlyMatch = value.match(/^(\d{2}:\d{2})(?::\d{2})?$/);
      if (timeOnlyMatch) {
        return timeOnlyMatch[1];
      }

      const isoMatch = value.match(/[T\s](\d{2}:\d{2})(?::\d{2})?/);
      if (isoMatch) {
        return isoMatch[1];
      }
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  async getSiteReports(days = 7, scopeOrganizationIds?: string[]) {
    const endDate = new Date();
    const safeDays = Number.isFinite(days)
      ? Math.min(Math.max(Math.trunc(days), 1), 30)
      : 7;
    const currentStartDate = getKstDaysAgoStart(safeDays - 1, endDate);
    const trendStartDate = getKstDaysAgoStart(29, endDate);
    const previousRangeStartDate = getKstDaysAgoStart((safeDays * 2) - 1, endDate);

    // 회사(root) 제외 모든 조직 조회 (현장, 부서, 팀, 현장조 등)
    const sites = await this.prisma.organization.findMany({
      where: {
        type: { not: 'company' },
        isActive: true,
        ...(scopeOrganizationIds ? { id: { in: scopeOrganizationIds } } : {}),
      },
      include: {
        parent: { select: { id: true, name: true } },
      },
      orderBy: [
        { type: 'asc' },
        { name: 'asc' },
      ],
    });

    const allOrganizations = await this.prisma.organization.findMany({
      where: {
        type: { not: 'company' },
        isActive: true,
        ...(scopeOrganizationIds ? { id: { in: scopeOrganizationIds } } : {}),
      },
      select: {
        id: true,
        parentId: true,
      },
    });

    if (sites.length === 0) {
      return [];
    }

    const siteIds = sites.map((site) => site.id);
    const childrenByParent = new Map<string, string[]>();
    for (const organization of allOrganizations) {
      if (!organization.parentId) {
        continue;
      }

      const childIds = childrenByParent.get(organization.parentId) || [];
      childIds.push(organization.id);
      childrenByParent.set(organization.parentId, childIds);
    }

    const subtreeCache = new Map<string, string[]>();
    const getSubtreeIds = (organizationId: string): string[] => {
      if (subtreeCache.has(organizationId)) {
        return subtreeCache.get(organizationId)!;
      }

      const childIds = childrenByParent.get(organizationId) || [];
      const subtreeIds = [organizationId, ...childIds.flatMap((childId) => getSubtreeIds(childId))];
      subtreeCache.set(organizationId, subtreeIds);
      return subtreeIds;
    };

    const relevantOrganizationIds = Array.from(new Set(sites.flatMap((site) => getSubtreeIds(site.id))));

    const [dailyStatsWindow, hourlyStatsWindow, employees, rawLogs] = await Promise.all([
      this.prisma.organizationDailyStat.findMany({
        where: {
          organizationId: { in: relevantOrganizationIds },
          date: { gte: previousRangeStartDate, lte: endDate },
        },
        orderBy: { date: 'asc' },
      }),
      this.prisma.hourlyBlockStat.findMany({
        where: {
          organizationId: { in: relevantOrganizationIds },
          date: { gte: currentStartDate },
        },
      }),
      this.prisma.employee.findMany({
        where: {
          OR: [
            { organizationId: { in: relevantOrganizationIds } },
            { siteId: { in: relevantOrganizationIds } },
          ],
        },
        select: {
          id: true,
          organizationId: true,
          siteId: true,
        },
      }),
      this.prisma.controlLog.findMany({
        where: {
          action: 'blocked',
          timestamp: { gte: currentStartDate, lte: endDate },
          OR: [
            { organizationId: { in: relevantOrganizationIds } },
            {
              AND: [
                { organizationId: null },
                { device: { organizationId: { in: relevantOrganizationIds } } },
              ],
            },
          ],
        },
        select: {
          organizationId: true,
          timestamp: true,
          type: true,
          appName: true,
          zoneId: true,
          device: {
            select: {
              organizationId: true,
            },
          },
          zone: { select: { name: true } },
          policy: {
            select: {
              behaviors: {
                select: {
                  behaviorCondition: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
              _count: {
                select: {
                  timePolicies: true,
                  zones: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const dailyStatsByOrg = new Map<string, typeof dailyStatsWindow>();
    for (const stat of dailyStatsWindow) {
      const bucket = dailyStatsByOrg.get(stat.organizationId) || [];
      bucket.push(stat);
      dailyStatsByOrg.set(stat.organizationId, bucket);
    }

    const hourlyStatsByOrg = new Map<string, typeof hourlyStatsWindow>();
    for (const stat of hourlyStatsWindow) {
      const bucket = hourlyStatsByOrg.get(stat.organizationId) || [];
      bucket.push(stat);
      hourlyStatsByOrg.set(stat.organizationId, bucket);
    }

    const rawLogsByOrg = new Map<string, typeof rawLogs>();
    for (const log of rawLogs) {
      const effectiveOrganizationId = log.organizationId || log.device?.organizationId;
      if (!effectiveOrganizationId) {
        continue;
      }

      const bucket = rawLogsByOrg.get(effectiveOrganizationId) || [];
      bucket.push(log);
      rawLogsByOrg.set(effectiveOrganizationId, bucket);
    }

    const trendDates: string[] = [];
    for (let day = 0; day < 30; day++) {
      const date = new Date(trendStartDate.getTime() + day * 86400000);
      trendDates.push(formatKstDateKey(date));
    }

    const result = [];
    for (const site of sites) {
      const subtreeIds = getSubtreeIds(site.id);
      const subtreeIdSet = new Set(subtreeIds);
      const orgStats = subtreeIds.flatMap((subtreeId) => dailyStatsByOrg.get(subtreeId) || []);
      const trendStats = orgStats.filter((s) => s.date >= trendStartDate);

      const prevStats = orgStats.filter((s) => s.date >= previousRangeStartDate && s.date < currentStartDate);
      const prevTotal = prevStats.reduce((sum, s) => sum + s.totalBlocks, 0);

      const dailyStatMap = new Map<string, { allowed: number; behavior: number }>();
      trendStats.forEach((item) => {
        const key = formatKstDateKey(item.date);
        const existing = dailyStatMap.get(key) || { allowed: 0, behavior: 0 };
        dailyStatMap.set(key, {
          allowed: existing.allowed + item.appControlBlocks,
          behavior: existing.behavior + item.behaviorBlocks,
        });
      });

      const employeeCount = employees.filter((employee) => (
        subtreeIdSet.has(employee.organizationId)
        || (employee.siteId ? subtreeIdSet.has(employee.siteId) : false)
      )).length;

      const subtreeLogs = subtreeIds.flatMap((subtreeId) => rawLogsByOrg.get(subtreeId) || []);
      const currentDailyLogMap = new Map<string, { allowed: number; behavior: number }>();
      const currentHourlyAgg = new Map<number, number>();
      const appCounts = new Map<string, number>();
      const behaviorConditionCounts = new Map<string, number>();
      const zoneCounts = new Map<string, number>();
      let timeConditionBlocks = 0;
      let zoneConditionBlocks = 0;
      let allowedAppBlocks = 0;
      let behaviorBlocks = 0;

      subtreeLogs.forEach((log) => {
        const dateKey = formatKstDateKey(log.timestamp);
        const dailyBucket = currentDailyLogMap.get(dateKey) || { allowed: 0, behavior: 0 };
        const hour = this.getKstHourFromUtc(log.timestamp);
        currentHourlyAgg.set(hour, (currentHourlyAgg.get(hour) || 0) + 1);

        if (log.type === 'behavior') {
          behaviorBlocks += 1;
          dailyBucket.behavior += 1;
        } else if (log.type === 'app_control') {
          allowedAppBlocks += 1;
          dailyBucket.allowed += 1;
        }

        currentDailyLogMap.set(dateKey, dailyBucket);

        const appName = String(log.appName || '').trim();
        if (appName.length > 0) {
          appCounts.set(appName, (appCounts.get(appName) || 0) + 1);
        }

        const zoneName = String(log.zone?.name || '').trim();
        if (zoneName.length > 0) {
          zoneCounts.set(zoneName, (zoneCounts.get(zoneName) || 0) + 1);
        }

        if (log.type === 'behavior') {
          const behaviorConditions = log.policy?.behaviors || [];
          behaviorConditions.forEach((behavior) => {
            const behaviorName = String(behavior.behaviorCondition?.name || '').trim();
            if (behaviorName.length > 0) {
              behaviorConditionCounts.set(
                behaviorName,
                (behaviorConditionCounts.get(behaviorName) || 0) + 1,
              );
            }
          });
        }

        if ((log.policy?._count?.timePolicies || 0) > 0) {
          timeConditionBlocks += 1;
        }

        if ((log.policy?._count?.zones || 0) > 0 || log.zoneId) {
          zoneConditionBlocks += 1;
        }
      });

      currentDailyLogMap.forEach((value, key) => {
        dailyStatMap.set(key, value);
      });

      const totalViolations = allowedAppBlocks + behaviorBlocks;
      const activeDays = currentDailyLogMap.size;
      const complianceRate = this.calculateWeightedComplianceRate({
        activeDays,
        appControlBlocks: allowedAppBlocks,
        behaviorBlocks,
        rounded: false,
      });

      let peakHour = '09:00';
      let peakBlocks = 0;
      currentHourlyAgg.forEach((count, hour) => {
        if (count > peakBlocks) {
          peakBlocks = count;
          peakHour = `${String(hour).padStart(2, '0')}:00`;
        }
      });

      const topApps = [...appCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([name, blocks]) => ({ name, blocks, iconUrl: '' }));

      const topBehaviorConditions = [...behaviorConditionCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([name, blocks]) => ({ name, blocks }));

      const zoneStats = [...zoneCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([zone, blocks]) => ({ zone, blocks }));

      const trendMap = new Map<string, SiteReportTrendPoint>(dailyStatMap);

      result.push(buildSiteReportItem({
        site: {
          id: site.id,
          name: site.name,
          type: site.type,
          parentName: site.parent?.name || null,
          employeeCount,
        },
        totalViolations,
        allowedAppBlocks,
        behaviorBlocks,
        complianceRate,
        prevTotal,
        peakHour,
        peakBlocks,
        trendDates,
        trendMap,
        topApps,
        topBehaviorConditions,
        zoneStats,
        timeConditionBlocks,
        zoneConditionBlocks,
      }));
    }

    return result;
  }
}
