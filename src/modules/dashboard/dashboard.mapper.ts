export interface SiteReportTrendPoint {
  allowed: number;
  behavior: number;
}

export interface SiteReportBase {
  id: string;
  name: string;
  type: string;
  parentName: string | null;
  employeeCount: number;
}

export function buildSiteReportItem(params: {
  site: SiteReportBase;
  totalViolations: number;
  allowedAppBlocks: number;
  behaviorBlocks: number;
  complianceRate: number;
  trend: 'up' | 'down' | 'stable';
  trendValue: number | null;
  prevTotal: number;
  peakHour: string;
  peakBlocks: number;
  trendDates: string[];
  trendMap: Map<string, SiteReportTrendPoint>;
  topApps?: Array<{ name: string; blocks: number; iconUrl: string }>;
  topBehaviorConditions?: Array<{ name: string; blocks: number }>;
  zoneStats?: Array<{ zone: string; blocks: number }>;
  timeConditionBlocks?: number;
  zoneConditionBlocks?: number;
}): {
  id: string;
  name: string;
  type: string;
  parentName: string | null;
  employeeCount: number;
  totalViolations: number;
  allowedAppBlocks: number;
  behaviorBlocks: number;
  complianceRate: number;
  trend: 'up' | 'down' | 'stable';
  trendValue: number | null;
  peakHour: string;
  peakBlocks: number;
  previousWeek: number;
  trendDates: string[];
  allowedAppTrend: number[];
  behaviorTrend: number[];
  topApps: Array<{ name: string; blocks: number; iconUrl: string }>;
  topBehaviorConditions: Array<{ name: string; blocks: number }>;
  zoneStats: Array<{ zone: string; blocks: number }>;
  timeConditionBlocks: number;
  zoneConditionBlocks: number;
} {
  const {
    site,
    totalViolations,
    allowedAppBlocks,
    behaviorBlocks,
    complianceRate,
    trend,
    trendValue,
    prevTotal,
    peakHour,
    peakBlocks,
    trendDates,
    trendMap,
    topApps = [],
    topBehaviorConditions = [],
    zoneStats = [],
    timeConditionBlocks = 0,
    zoneConditionBlocks = 0,
  } = params;

  const allowedAppTrend: number[] = [];
  const behaviorTrend: number[] = [];

  for (const date of trendDates) {
    const point = trendMap.get(date) || { allowed: 0, behavior: 0 };
    allowedAppTrend.push(point.allowed);
    behaviorTrend.push(point.behavior);
  }

  return {
    id: site.id,
    name: site.name,
    type: site.type,
    parentName: site.parentName,
    employeeCount: site.employeeCount,
    totalViolations,
    allowedAppBlocks,
    behaviorBlocks,
    complianceRate: Math.round(complianceRate * 10) / 10,
    trend,
    trendValue: trendValue === null ? null : Math.abs(trendValue),
    peakHour,
    peakBlocks,
    previousWeek: prevTotal,
    trendDates,
    allowedAppTrend,
    behaviorTrend,
    topApps,
    topBehaviorConditions,
    zoneStats,
    timeConditionBlocks,
    zoneConditionBlocks,
  };
}
