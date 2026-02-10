import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [
      totalEmployees,
      activeEmployees,
      totalDevices,
      activeDevices,
      activePolicies,
      dangerZones,
      todayLogs,
    ] = await Promise.all([
      this.prisma.employee.count(),
      this.prisma.employee.count({ where: { status: 'ACTIVE' } }),
      this.prisma.device.count(),
      this.prisma.device.count({ where: { status: 'NORMAL' } }),
      this.prisma.controlPolicy.count({ where: { isActive: true } }),
      this.prisma.zone.count({ where: { type: 'danger', isActive: true } }),
      this.prisma.controlLog.count({
        where: {
          timestamp: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    return {
      totalEmployees,
      activeEmployees,
      totalDevices,
      activeDevices,
      activePolicies,
      criticalZones: dangerZones,
      todayViolations: todayLogs,
      onlineEmployees: activeDevices,
    };
  }

  async getHourlyData(organizationId?: string, date?: string) {
    let targetDate: Date;
    if (date) {
      targetDate = new Date(date);
    } else {
      // 오늘 데이터가 없으면 어제 데이터를 시도
      targetDate = new Date();
    }
    targetDate.setHours(0, 0, 0, 0);

    const where: any = { date: targetDate };
    if (organizationId) {
      where.organizationId = organizationId;
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

  async getZoneViolationData(startDate?: string, endDate?: string) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 7 * 86400000);

    const stats = await this.prisma.zoneViolationStat.findMany({
      where: {
        date: { gte: start, lte: end },
      },
      include: {
        zone: { select: { id: true, name: true, type: true } },
      },
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
        employees: existing.employees + s.uniqueEmployees,
      });
    });

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

  async getOrganizationDailyStats(organizationId?: string, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const where: any = { date: { gte: startDate } };
    if (organizationId) {
      where.organizationId = organizationId;
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
  }) {
    const days = filter.days || 7;
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const where: any = { date: { gte: startDate } };
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.organizationId) where.organizationId = filter.organizationId;

    // 직원별로 집계
    const rawStats = await this.prisma.employeeDailyStat.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            organization: { select: { id: true, name: true } },
            workType: { select: { id: true, name: true } },
            hireDate: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    // 직원별 집계
    const empMap = new Map<string, any>();
    rawStats.forEach((stat) => {
      const empId = stat.employeeId;
      const existing = empMap.get(empId);
      if (!existing) {
        empMap.set(empId, {
          employeeId: empId,
          employeeName: stat.employee?.name || '',
          organizationId: stat.employee?.organizationId || '',
          organizationName: stat.employee?.organization?.name || '',
          workType: stat.employee?.workType?.name || '',
          hireDate: stat.employee?.hireDate || null,
          totalBlocks: stat.totalBlocks,
          behaviorBlocks: stat.behaviorBlocks,
          harmfulAppBlocks: stat.harmfulAppBlocks,
          zoneViolations: stat.zoneViolations,
          topBlockedApp: stat.topBlockedApp,
          dailyStats: [stat],
        });
      } else {
        existing.totalBlocks += stat.totalBlocks;
        existing.behaviorBlocks += stat.behaviorBlocks;
        existing.harmfulAppBlocks += stat.harmfulAppBlocks;
        existing.zoneViolations += stat.zoneViolations;
        existing.dailyStats.push(stat);
        if (!existing.topBlockedApp && stat.topBlockedApp) {
          existing.topBlockedApp = stat.topBlockedApp;
        }
      }
    });

    const aggregated = Array.from(empMap.values())
      .sort((a, b) => b.totalBlocks - a.totalBlocks);

    const total = aggregated.length;
    const paged = aggregated.slice(skip, skip + limit).map((emp) => {
      const recentStats = emp.dailyStats.slice(0, 7);
      const olderStats = emp.dailyStats.slice(7, 14);
      const recentTotal = recentStats.reduce((sum: number, s: any) => sum + s.totalBlocks, 0);
      const olderTotal = olderStats.reduce((sum: number, s: any) => sum + s.totalBlocks, 0);

      let trend = 'stable';
      if (recentTotal > olderTotal * 1.2) trend = 'up';
      else if (recentTotal < olderTotal * 0.8) trend = 'down';

      const complianceRate = emp.totalBlocks > 0
        ? Math.max(0, Math.round(100 - emp.totalBlocks * 2))
        : 100;

      let riskLevel = '낮음';
      if (emp.totalBlocks > 20 || emp.zoneViolations > 5) riskLevel = '높음';
      else if (emp.totalBlocks > 10 || emp.zoneViolations > 2) riskLevel = '보통';

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
  async getEmployeeReportDetail(employeeId: string) {
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

    // ── 집계: 통계 ──
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

    const complianceRate = totalBlocks > 0 ? Math.max(0, Math.round(100 - totalBlocks * 2)) : 100;

    let riskLevel = '낮음';
    if (totalBlocks > 20 || zoneViolations > 5) riskLevel = '높음';
    else if (totalBlocks > 10 || zoneViolations > 2) riskLevel = '보통';

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
    const zoneCounts = new Map<string, { name: string; count: number }>();
    controlLogs
      .filter((l) => l.zone)
      .forEach((l) => {
        const key = l.zone!.id;
        const existing = zoneCounts.get(key);
        if (existing) existing.count++;
        else zoneCounts.set(key, { name: l.zone!.name, count: 1 });
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

    const totalLogCount = controlLogs.length || 1;
    const morningLogs = controlLogs.filter((l) => {
      const h = l.timestamp.getHours();
      return h >= 8 && h <= 10;
    }).length;
    const eveningLogs = controlLogs.filter((l) => {
      const h = l.timestamp.getHours();
      return h >= 16 && h <= 18;
    }).length;
    const offHoursActivity = controlLogs.filter((l) => {
      const h = l.timestamp.getHours();
      return h < 7 || h > 19;
    }).length;

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
      avgWorkHours: 8.0,

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
        restrictedZoneEntries: zoneViolations,
        avgStayTime: 0,
        topRestrictedZones,
        peakBlockTime:
          controlLogs.length > 0
            ? `${String(peakBlockHour).padStart(2, '0')}:00`
            : '해당 없음',
        morningBlockRate: Math.round((morningLogs / totalLogCount) * 100),
        eveningBlockRate: Math.round((eveningLogs / totalLogCount) * 100),
        weeklyIncreaseRate,
        consecutiveBlocks: 0,
        vsWorkTypeAvg,
        vsSiteAvg,
        offHoursActivity,
        longStayInRestrictedZone: 0,
      },

      trendData,
      violationHistory,
    };
  }

  async getSiteReports() {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 7 * 86400000);
    startDate.setHours(0, 0, 0, 0);

    // 회사(root) 제외 모든 조직 조회 (현장, 부서, 팀, 현장조 등)
    const sites = await this.prisma.organization.findMany({
      where: { type: { not: 'company' } },
      include: {
        _count: { select: { employees: true } },
        parent: { select: { id: true, name: true } },
      },
    });

    const result = [];
    for (const site of sites) {
      const stats = await this.prisma.organizationDailyStat.findMany({
        where: {
          organizationId: site.id,
          date: { gte: startDate, lte: endDate },
        },
        orderBy: { date: 'desc' },
      });

      const totalViolations = stats.reduce((sum, s) => sum + s.totalBlocks, 0);
      const behaviorBlocks = stats.reduce((sum, s) => sum + s.behaviorBlocks, 0);
      const harmfulAppBlocks = stats.reduce((sum, s) => sum + s.harmfulAppBlocks, 0);
      const avgCompliance = stats.length > 0
        ? stats.reduce((sum, s) => sum + Number(s.complianceRate || 0), 0) / stats.length
        : 0;

      // 이전 주 데이터
      const prevStart = new Date(startDate.getTime() - 7 * 86400000);
      const prevStats = await this.prisma.organizationDailyStat.findMany({
        where: {
          organizationId: site.id,
          date: { gte: prevStart, lt: startDate },
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
          date: { gte: startDate },
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

      result.push({
        id: site.id,
        name: site.name,
        type: site.type,
        parentName: (site as any).parent?.name || null,
        employeeCount: site._count.employees,
        totalViolations,
        harmfulAppBlocks,
        behaviorBlocks,
        complianceRate: Math.round(avgCompliance * 10) / 10,
        trend: trendValue > 0 ? 'up' : trendValue < 0 ? 'down' : 'stable',
        trendValue: Math.abs(trendValue),
        peakHour,
        peakBlocks,
        previousWeek: {
          totalViolations: prevTotal,
        },
      });
    }

    return result;
  }
}
