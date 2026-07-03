import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

/**
 * 통계 야간 자동 재집계 스케줄러.
 * 인제스션 통계 반영 실패/원시로그 보정 등으로 집계 테이블이 ControlLog와 어긋날 수 있어,
 * 매일 KST 새벽에 최근 며칠치를 전체 조직에 대해 ControlLog 기준으로 재생성(자가치유)한다.
 * (기존 EmployeesHardDeleteScheduler와 동일한 setInterval + KST 실행창 패턴)
 */
@Injectable()
export class DashboardReaggregateScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DashboardReaggregateScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastRunDateKey: string | null = null;

  private static readonly CHECK_INTERVAL_MS = 60 * 1000;
  private static readonly RUN_HOUR_KST = 3;
  private static readonly RUN_MINUTE_KST = 0;
  private static readonly RUN_WINDOW_MINUTES = 5;
  // 오늘 + 어제(뒤늦게 도착한 이벤트/당일 드리프트까지 정정). 필요 시 조정.
  private static readonly RECENT_DAYS = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardService: DashboardService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runTick();
    }, DashboardReaggregateScheduler.CHECK_INTERVAL_MS);

    this.logger.log(
      `통계 야간 재집계 스케줄러 시작 (runAt=KST ${String(DashboardReaggregateScheduler.RUN_HOUR_KST).padStart(2, '0')}:${String(DashboardReaggregateScheduler.RUN_MINUTE_KST).padStart(2, '0')}, recentDays=${DashboardReaggregateScheduler.RECENT_DAYS})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private toKst(date: Date): Date {
    return new Date(date.getTime() + 9 * 60 * 60 * 1000);
  }

  private formatKstDateKey(kst: Date): string {
    return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
  }

  private async runTick(): Promise<void> {
    const kst = this.toKst(new Date());
    const dateKey = this.formatKstDateKey(kst);
    const hour = kst.getUTCHours();
    const minute = kst.getUTCMinutes();

    const inRunWindow = hour === DashboardReaggregateScheduler.RUN_HOUR_KST
      && minute >= DashboardReaggregateScheduler.RUN_MINUTE_KST
      && minute < DashboardReaggregateScheduler.RUN_MINUTE_KST + DashboardReaggregateScheduler.RUN_WINDOW_MINUTES;

    if (!inRunWindow || this.lastRunDateKey === dateKey) {
      return;
    }

    if (this.isRunning) {
      this.logger.warn('이전 야간 재집계가 아직 진행 중이라 이번 tick을 건너뜁니다.');
      return;
    }

    this.lastRunDateKey = dateKey;
    this.isRunning = true;
    const startedAt = Date.now();

    try {
      await this.reaggregateRecentDays(kst);
    } catch (error) {
      this.logger.error(`야간 재집계 tick 실패: ${String(error)}`);
    } finally {
      this.isRunning = false;
      this.logger.log(`야간 재집계 tick 종료 (durationMs=${Date.now() - startedAt})`);
    }
  }

  private async reaggregateRecentDays(kstNow: Date): Promise<void> {
    const organizations = await this.prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    const organizationIds = organizations.map((organization) => organization.id);

    if (organizationIds.length === 0) {
      this.logger.warn('활성 조직이 없어 야간 재집계를 건너뜁니다.');
      return;
    }

    for (let offset = 0; offset < DashboardReaggregateScheduler.RECENT_DAYS; offset += 1) {
      const targetKst = new Date(kstNow.getTime() - offset * 24 * 60 * 60 * 1000);
      const dateStr = this.formatKstDateKey(targetKst);

      try {
        const result = await this.dashboardService.reaggregateDay(
          { date: dateStr },
          null,
          organizationIds,
          { skipAuditLog: true },
        );
        this.logger.log(
          `야간 재집계 완료 (date=${dateStr}, organizations=${result.results.length}, employees=${result.employeeStats.rebuiltEmployees})`,
        );
      } catch (error) {
        this.logger.error(`야간 재집계 일자 실패 (date=${dateStr}): ${String(error)}`);
      }
    }
  }
}
