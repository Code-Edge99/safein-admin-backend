import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    if (!organizationId || !scopeOrganizationIds) {
      return;
    }

    if (!scopeOrganizationIds.includes(organizationId)) {
      throw new ForbiddenException('요청한 조직은 접근 권한 범위를 벗어났습니다.');
    }
  }

  private inScope(scopeOrganizationIds?: string[]): { in: string[] } | undefined {
    if (!scopeOrganizationIds) {
      return undefined;
    }
    return { in: scopeOrganizationIds };
  }

  async getStats(scopeOrganizationIds?: string[]) {
    const now = new Date();
    const onlineThreshold = new Date(now.getTime() - 15 * 60 * 1000);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      totalEmployees,
      activeEmployees,
      totalDevices,
      activeDevices,
      activePolicies,
      dangerZones,
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
          type: 'danger',
          isActive: true,
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
          ...(scopeOrganizationIds
            ? {
                employee: {
                  organizationId: { in: scopeOrganizationIds },
                },
              }
            : {}),
        },
      }),
      this.prisma.controlLog.count({
        where: {
          action: 'blocked',
          timestamp: { gte: yesterdayStart, lt: todayStart },
          ...(scopeOrganizationIds
            ? {
                employee: {
                  organizationId: { in: scopeOrganizationIds },
                },
              }
            : {}),
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
                employee: {
                  is: {
                    organizationId: { in: scopeOrganizationIds },
                  },
                },
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
      criticalZones: dangerZones,
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
      targetDate = new Date(date);
    } else {
      // 오늘 데이터가 없으면 어제 데이터를 시도
      targetDate = new Date();
    }
    targetDate.setHours(0, 0, 0, 0);

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    const where: any = { date: targetDate };
    if (organizationId) {
      where.organizationId = organizationId;
    } else if (scopeOrganizationIds) {
      where.organizationId = { in: scopeOrganizationIds };
    }

    let stats = await this.prisma.hourlyBlockStat.findMany({
      where,
      orderBy: { hour: 'asc' },
    });

    // 오늘 데이터가 없으면 어제 데이터 조회
    if (stats.length === 0 && !date) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
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
      const existing = hourlyMap.get(s.hour) || { totalBlocks: 0, behaviorBlocks: 0, harmfulAppBlocks: 0 };
      hourlyMap.set(s.hour, {
        totalBlocks: existing.totalBlocks + s.totalBlocks,
        behaviorBlocks: existing.behaviorBlocks + s.behaviorBlocks,
        harmfulAppBlocks: existing.harmfulAppBlocks + s.harmfulAppBlocks,
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
          ...(organizationId
            ? {
                employee: {
                  organizationId,
                },
              }
            : scopeOrganizationIds
              ? {
                  employee: {
                    organizationId: { in: scopeOrganizationIds },
                  },
                }
              : {}),
        },
        select: {
          timestamp: true,
          type: true,
        },
      });

      logs.forEach((log) => {
        const hour = log.timestamp.getHours();
        const existing = hourlyMap.get(hour) || { totalBlocks: 0, behaviorBlocks: 0, harmfulAppBlocks: 0 };
        hourlyMap.set(hour, {
          totalBlocks: existing.totalBlocks + 1,
          behaviorBlocks: existing.behaviorBlocks + (log.type === 'behavior' ? 1 : 0),
          harmfulAppBlocks: existing.harmfulAppBlocks + (log.type === 'harmful_app' ? 1 : 0),
        });
      });
    }

    const result = [];
    for (let h = 0; h < 24; h++) {
      const data = hourlyMap.get(h) || { totalBlocks: 0, behaviorBlocks: 0, harmfulAppBlocks: 0 };
      result.push({
        hour: `${String(h).padStart(2, '0')}:00`,
        차단: data.totalBlocks,
        행동감지: data.behaviorBlocks,
        유해앱: data.harmfulAppBlocks,
      });
    }

    return result;
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

    // 구역별 집계
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
      work: '주의',
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
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

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

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    this.ensureOrganizationInScope(filter.organizationId, filter.scopeOrganizationIds);

    const employeeWhere: any = {};
    if (filter.employeeId) employeeWhere.id = filter.employeeId;
    if (filter.organizationId) employeeWhere.organizationId = filter.organizationId;
    else if (filter.scopeOrganizationIds) employeeWhere.organizationId = { in: filter.scopeOrganizationIds };

    const employees = await this.prisma.employee.findMany({
      where: employeeWhere,
      select: {
        id: true,
        name: true,
        organizationId: true,
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        hireDate: true,
      },
      orderBy: { name: 'asc' },
    });

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

    const empMap = new Map<string, any>();
    employees.forEach((employee) => {
      empMap.set(employee.id, {
        employeeId: employee.id,
        employeeName: employee.name || '',
        organizationId: employee.organizationId || '',
        organizationName: employee.organization?.name || '',
        workType: employee.workType?.name || '',
        hireDate: employee.hireDate || null,
        totalBlocks: 0,
        totalEvents: 0,
        allowedEvents: 0,
        behaviorBlocks: 0,
        harmfulAppBlocks: 0,
        zoneViolations: 0,
        topBlockedApp: null,
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
      existing.harmfulAppBlocks += stat.harmfulAppBlocks;
      existing.zoneViolations += stat.zoneViolations;
      existing.dailyStats.push(stat);
      if (!existing.topBlockedApp && stat.topBlockedApp) {
        existing.topBlockedApp = stat.topBlockedApp;
      }
    });

    const aggregated = Array.from(empMap.values()).sort((a, b) => {
      if (b.totalBlocks !== a.totalBlocks) {
        return b.totalBlocks - a.totalBlocks;
      }
      return a.employeeName.localeCompare(b.employeeName);
    });

    const total = aggregated.length;
    const paged = aggregated.slice(skip, skip + limit).map((emp) => {
      const recentStats = emp.dailyStats.slice(0, 7);
      const olderStats = emp.dailyStats.slice(7, 14);
      const recentTotal = recentStats.reduce((sum: number, s: any) => sum + s.totalBlocks, 0);
      const olderTotal = olderStats.reduce((sum: number, s: any) => sum + s.totalBlocks, 0);

      let trend = 'stable';
      if (recentTotal > olderTotal * 1.2) trend = 'up';
      else if (recentTotal < olderTotal * 0.8) trend = 'down';

      const complianceRate = emp.totalEvents > 0
        ? Math.round((emp.allowedEvents / emp.totalEvents) * 100)
        : 100;

      let riskLevel = '낮음';
      if (emp.totalBlocks > 20 || emp.zoneViolations > 5 || complianceRate < 60) riskLevel = '높음';
      else if (emp.totalBlocks > 10 || emp.zoneViolations > 2 || complianceRate < 80) riskLevel = '보통';

      return {
        id: emp.employeeId,
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        organizationId: emp.organizationId,
        organizationName: emp.organizationName,
        workType: emp.workType,
        totalBlocks: emp.totalBlocks,
        last7DaysBlocks: recentTotal,
        trend,
        blockedAppsCount: emp.harmfulAppBlocks,
        topBlockedApp: emp.topBlockedApp || '-',
        complianceRate,
        riskLevel,
        lastViolation: emp.dailyStats[0]?.date || null,
        hireDate: emp.hireDate,
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
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        organization: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
      },
    });

    if (!employee) return null;

    this.ensureOrganizationInScope(employee.organizationId, scopeOrganizationIds);

    const now = new Date();
    const startDate30 = new Date();
    startDate30.setDate(startDate30.getDate() - 30);
    startDate30.setHours(0, 0, 0, 0);

    // 2. 일별 통계 (EmployeeDailyStat, 30일)
    const dailyStats = await this.prisma.employeeDailyStat.findMany({
      where: { employeeId, date: { gte: startDate30 } },
      orderBy: { date: 'asc' },
    });

    // 3. 제어 로그 (ControlLog, 30일) — 실제 이벤트 데이터
    const controlLogs = await this.prisma.controlLog.findMany({
      where: { employeeId, timestamp: { gte: startDate30 } },
      include: {
        zone: { select: { id: true, name: true, type: true } },
        policy: { select: { id: true, name: true } },
      },
      orderBy: { timestamp: 'desc' },
    });

    const [zoneVisitSessions, workSessions] = await Promise.all([
      this.prisma.zoneVisitSession.findMany({
        where: {
          employeeId,
          enteredAt: { gte: startDate30 },
        },
        include: {
          zone: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.workSession.findMany({
        where: {
          employeeId,
          startedAt: { gte: startDate30 },
          endedAt: { not: null },
        },
        select: {
          durationSeconds: true,
        },
      }),
    ]);

    const appliedPolicy = await this.resolveAppliedPolicyForEmployee(
      employee.id,
      employee.organizationId,
      employee.workTypeId,
    );

    // ── 집계: 통계 ──
    const totalEvents = dailyStats.reduce((s, d) => s + ((d as any).totalEvents ?? d.totalBlocks), 0);
    const allowedEvents = dailyStats.reduce((s, d) => s + ((d as any).allowedEvents ?? 0), 0);
    const totalBlocks = dailyStats.reduce((s, d) => s + d.totalBlocks, 0);
    const behaviorBlocks = dailyStats.reduce((s, d) => s + d.behaviorBlocks, 0);
    const harmfulAppBlocks = dailyStats.reduce((s, d) => s + d.harmfulAppBlocks, 0);
    const zoneViolations = dailyStats.reduce((s, d) => s + d.zoneViolations, 0);

    // 최근 7일 vs 이전 7일 비교
    const day7Ago = new Date();
    day7Ago.setDate(day7Ago.getDate() - 7);
    const day14Ago = new Date();
    day14Ago.setDate(day14Ago.getDate() - 14);

    const recentStats = dailyStats.filter((s) => s.date >= day7Ago);
    const olderStats = dailyStats.filter((s) => s.date >= day14Ago && s.date < day7Ago);
    const recentTotal = recentStats.reduce((s, d) => s + d.totalBlocks, 0);
    const olderTotal = olderStats.reduce((s, d) => s + d.totalBlocks, 0);

    let trend = 'stable';
    if (recentTotal > olderTotal * 1.2) trend = 'up';
    else if (recentTotal < olderTotal * 0.8) trend = 'down';

    const complianceRate = totalEvents > 0 ? Math.round((allowedEvents / totalEvents) * 100) : 100;

    let riskLevel = '낮음';
    if (totalBlocks > 20 || zoneViolations > 5 || complianceRate < 60) riskLevel = '높음';
    else if (totalBlocks > 10 || zoneViolations > 2 || complianceRate < 80) riskLevel = '보통';

    const weeklyIncreaseRate = olderTotal > 0
      ? Math.round(((recentTotal - olderTotal) / olderTotal) * 100)
      : 0;

    // ── 인사이트: 앱별 위반 Top 3 (ControlLog 기반) ──
    const appCounts = new Map<string, number>();
    controlLogs
      .filter((l) => l.appName)
      .forEach((l) => appCounts.set(l.appName!, (appCounts.get(l.appName!) || 0) + 1));
    const topViolationApps = Array.from(appCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    const uniqueAppCount = appCounts.size;
    const topBlockedApp = topViolationApps.length > 0 ? topViolationApps[0].name : '-';

    // ── 인사이트: 구역별 진입 Top 3 (ControlLog 기반) ──
    const restrictedZoneTypes = new Set(['danger', 'work']);
    const zoneCounts = new Map<string, { name: string; count: number }>();
    zoneVisitSessions
      .filter((s) => s.zone && restrictedZoneTypes.has(s.zone.type))
      .forEach((s) => {
        const key = s.zone.id;
        const existing = zoneCounts.get(key);
        if (existing) existing.count++;
        else zoneCounts.set(key, { name: s.zone.name, count: 1 });
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

    const closedRestrictedZoneSessions = zoneVisitSessions.filter(
      (s) =>
        s.zone &&
        restrictedZoneTypes.has(s.zone.type) &&
        s.exitedAt &&
        s.durationSeconds !== null,
    );
    const avgStayTime =
      closedRestrictedZoneSessions.length > 0
        ? Math.round(
            closedRestrictedZoneSessions.reduce(
              (sum, session) => sum + Math.max(0, (session.durationSeconds || 0) / 60),
              0,
            ) / closedRestrictedZoneSessions.length,
          )
        : 0;
    const longStayInRestrictedZone = closedRestrictedZoneSessions.filter(
      (s) => (s.durationSeconds || 0) >= 30 * 60,
    ).length;

    const locationLogs = await this.prisma.deviceLocation.findMany({
      where: {
        device: { employeeId },
        timestamp: { gte: startDate30 },
      },
      select: { timestamp: true },
      orderBy: { timestamp: 'asc' },
    });

    const dayRangeMap = new Map<string, { min: number; max: number }>();
    locationLogs.forEach((entry) => {
      const key = entry.timestamp.toISOString().split('T')[0];
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
          employeeId: { not: employeeId },
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
        employeeId: { not: employeeId },
      },
      _avg: { totalBlocks: true },
    });
    const peerSiteAvg = peerSiteStats._avg.totalBlocks || 0;
    if (peerSiteAvg > 0) {
      vsSiteAvg = Math.round(((totalBlocks / 30 - peerSiteAvg) / peerSiteAvg) * 100);
    }

    // ── 추이 데이터 (일별) ──
    const trendData = dailyStats.map((s) => ({
      date: s.date.toISOString().split('T')[0].slice(5), // MM-DD
      유해앱: s.harmfulAppBlocks,
      행동차단: s.behaviorBlocks,
    }));

    // ── 발생 이력 (ControlLog 최근 50건) ──
    const violationHistory = controlLogs.slice(0, 50).map((l) => ({
      id: l.id,
      type: l.type === 'harmful_app' ? '유해앱 사용' : '행동 감지',
      action: l.action === 'blocked' ? '차단' : '허용',
      timestamp: l.timestamp.toISOString(),
      zoneName: l.zone?.name || null,
      appName: l.appName || null,
      description:
        l.reason ||
        (l.type === 'harmful_app'
          ? `${l.appName || '유해앱'} 사용 감지`
          : '행동 패턴 감지'),
    }));

    // ── 근속 기간 계산 ──
    let tenure = '-';
    if (employee.hireDate) {
      const diff = now.getTime() - employee.hireDate.getTime();
      const years = Math.floor(diff / (365.25 * 86400000));
      const months = Math.floor((diff % (365.25 * 86400000)) / (30.44 * 86400000));
      if (years > 0) tenure = `${years}년 ${months}개월`;
      else tenure = `${months}개월`;
    }

    return {
      id: employee.id,
      employeeId: employee.id,
      employeeName: employee.name,
      organizationId: employee.organizationId,
      organizationName: employee.organization?.name || '',
      workType: employee.workType?.name || '-',
      hireDate: employee.hireDate
        ? employee.hireDate.toISOString().split('T')[0]
        : null,
      tenure,
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
      lastViolation: controlLogs[0]?.timestamp?.toISOString() || null,

      insights: {
        topViolationApps,
        restrictedZoneEntries: zoneVisitSessions.filter(
          (s) => s.zone && restrictedZoneTypes.has(s.zone.type),
        ).length,
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
                  zone: { select: { id: true, name: true, type: true, description: true } },
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
                    select: { id: true, name: true, description: true, type: true },
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
                  zone: { select: { id: true, name: true, type: true, description: true } },
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
                    select: { id: true, name: true, description: true, type: true },
                  },
                },
              },
            },
          })
        : Promise.resolve(null),
    ]);

    const assignedPolicyIds = new Set(assignedPolicies.map((item) => item.policyId));
    const mergedPolicies = [
      ...assignedPolicies.map((item) => item.policy),
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
      timePolicies: (selectedPolicy.timePolicies || []).map((item: any) => item.timePolicy),
      zones: (selectedPolicy.zones || []).map((item: any) => item.zone),
      behaviorConditions: (selectedPolicy.behaviors || []).map((item: any) => item.behaviorCondition),
    };
  }

  async getSiteReports(scopeOrganizationIds?: string[]) {
    const endDate = new Date();
    const currentStartDate = new Date(endDate.getTime() - 7 * 86400000);
    currentStartDate.setHours(0, 0, 0, 0);

    const trendStartDate = new Date(endDate.getTime() - 29 * 86400000);
    trendStartDate.setHours(0, 0, 0, 0);

    const prevWeekStartDate = new Date(currentStartDate.getTime() - 7 * 86400000);
    prevWeekStartDate.setHours(0, 0, 0, 0);

    // 회사(root) 제외 모든 조직 조회 (현장, 부서, 팀, 현장조 등)
    const sites = await this.prisma.organization.findMany({
      where: {
        type: { not: 'company' },
        ...(scopeOrganizationIds ? { id: { in: scopeOrganizationIds } } : {}),
      },
      include: {
        _count: { select: { employees: true } },
        parent: { select: { id: true, name: true } },
      },
    });

    const result = [];
    for (const site of sites) {
      const trendStats = await this.prisma.organizationDailyStat.findMany({
        where: {
          organizationId: site.id,
          date: { gte: trendStartDate, lte: endDate },
        },
        orderBy: { date: 'asc' },
      });

      const currentStats = trendStats.filter((s) => s.date >= currentStartDate);

      const totalViolations = currentStats.reduce((sum, s) => sum + s.totalBlocks, 0);
      const behaviorBlocks = currentStats.reduce((sum, s) => sum + s.behaviorBlocks, 0);
      const harmfulAppBlocks = currentStats.reduce((sum, s) => sum + s.harmfulAppBlocks, 0);
      const totalEvents = currentStats.reduce(
        (sum, s) => sum + ((s as any).totalEvents ?? s.totalBlocks),
        0,
      );
      const allowedEvents = currentStats.reduce(
        (sum, s) => sum + ((s as any).allowedEvents ?? 0),
        0,
      );
      const complianceRate = totalEvents > 0 ? (allowedEvents / totalEvents) * 100 : 100;

      // 이전 주 데이터
      const prevStats = await this.prisma.organizationDailyStat.findMany({
        where: {
          organizationId: site.id,
          date: { gte: prevWeekStartDate, lt: currentStartDate },
        },
      });
      const prevTotal = prevStats.reduce((sum, s) => sum + s.totalBlocks, 0);

      const trendValue = prevTotal > 0
        ? Math.round(((totalViolations - prevTotal) / prevTotal) * 100)
        : 0;

      // 시간대별 위반
      const hourlyStats = await this.prisma.hourlyBlockStat.findMany({
        where: {
          organizationId: site.id,
          date: { gte: currentStartDate },
        },
      });

      let peakHour = '09:00';
      let peakBlocks = 0;
      const hourlyAgg = new Map<number, number>();
      hourlyStats.forEach((h) => {
        const cur = (hourlyAgg.get(h.hour) || 0) + h.totalBlocks;
        hourlyAgg.set(h.hour, cur);
        if (cur > peakBlocks) {
          peakBlocks = cur;
          peakHour = `${String(h.hour).padStart(2, '0')}:00`;
        }
      });

      const dailyStatMap = new Map<string, { harmful: number; behavior: number }>();
      trendStats.forEach((item) => {
        const key = item.date.toISOString().split('T')[0];
        dailyStatMap.set(key, {
          harmful: item.harmfulAppBlocks,
          behavior: item.behaviorBlocks,
        });
      });

      const trendDates: string[] = [];
      const harmfulAppTrend: number[] = [];
      const behaviorTrend: number[] = [];
      for (let day = 0; day < 30; day++) {
        const date = new Date(trendStartDate.getTime() + day * 86400000);
        const key = date.toISOString().split('T')[0];
        const data = dailyStatMap.get(key) || { harmful: 0, behavior: 0 };
        trendDates.push(key);
        harmfulAppTrend.push(data.harmful);
        behaviorTrend.push(data.behavior);
      }

      result.push({
        id: site.id,
        name: site.name,
        type: site.type,
        parentName: (site as any).parent?.name || null,
        employeeCount: site._count.employees,
        totalViolations,
        harmfulAppBlocks,
        behaviorBlocks,
        complianceRate: Math.round(complianceRate * 10) / 10,
        trend: trendValue > 0 ? 'up' : trendValue < 0 ? 'down' : 'stable',
        trendValue: Math.abs(trendValue),
        peakHour,
        peakBlocks,
        previousWeek: prevTotal,
        trendDates,
        harmfulAppTrend,
        behaviorTrend,
      });
    }

    return result;
  }
}
