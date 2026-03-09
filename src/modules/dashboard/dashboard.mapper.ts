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
  prevTotal: number;
  peakHour: string;
  peakBlocks: number;
  trendDates: string[];
  trendMap: Map<string, SiteReportTrendPoint>;
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
  trendValue: number;
  peakHour: string;
  peakBlocks: number;
  previousWeek: number;
  trendDates: string[];
  allowedAppTrend: number[];
  behaviorTrend: number[];
} {
  const {
    site,
    totalViolations,
    allowedAppBlocks,
    behaviorBlocks,
    complianceRate,
    prevTotal,
    peakHour,
    peakBlocks,
    trendDates,
    trendMap,
  } = params;

  const trendValue = prevTotal > 0
    ? Math.round(((totalViolations - prevTotal) / prevTotal) * 100)
    : 0;

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
    trend: trendValue > 0 ? 'up' : trendValue < 0 ? 'down' : 'stable',
    trendValue: Math.abs(trendValue),
    peakHour,
    peakBlocks,
    previousWeek: prevTotal,
    trendDates,
    allowedAppTrend,
    behaviorTrend,
  };
}
