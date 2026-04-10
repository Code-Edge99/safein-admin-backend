import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EmployeesService } from './employees.service';

@Injectable()
export class EmployeesHardDeleteScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmployeesHardDeleteScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastRunDateKey: string | null = null;

  private static readonly CHECK_INTERVAL_MS = 60 * 1000;
  private static readonly RUN_HOUR_KST = 12;
  private static readonly RUN_MINUTE_KST = 0;
  private static readonly RUN_WINDOW_MINUTES = 5;
  private static readonly BATCH_SIZE = 100;

  constructor(private readonly employeesService: EmployeesService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runTick();
    }, EmployeesHardDeleteScheduler.CHECK_INTERVAL_MS);

    void this.runTick();
    this.logger.log(
      `삭제 만료 하드삭제 스케줄러 시작 (policy=30days, runAt=KST ${String(EmployeesHardDeleteScheduler.RUN_HOUR_KST).padStart(2, '0')}:${String(EmployeesHardDeleteScheduler.RUN_MINUTE_KST).padStart(2, '0')})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runTick(): Promise<void> {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dateKey = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
    const hour = kst.getUTCHours();
    const minute = kst.getUTCMinutes();

    const inRunWindow = hour === EmployeesHardDeleteScheduler.RUN_HOUR_KST
      && minute >= EmployeesHardDeleteScheduler.RUN_MINUTE_KST
      && minute < EmployeesHardDeleteScheduler.RUN_MINUTE_KST + EmployeesHardDeleteScheduler.RUN_WINDOW_MINUTES;

    if (!inRunWindow || this.lastRunDateKey === dateKey) {
      return;
    }

    if (this.isRunning) {
      this.logger.warn('이전 하드삭제 작업이 아직 진행 중이라 이번 tick을 건너뜁니다.');
      return;
    }

    this.lastRunDateKey = dateKey;
    this.isRunning = true;
    const startedAt = Date.now();

    try {
      const result = await this.employeesService.hardDeleteExpiredDeletedEmployees({
        limit: EmployeesHardDeleteScheduler.BATCH_SIZE,
        dryRun: false,
      });

      this.logger.log(
        `삭제 만료 하드삭제 tick 완료 (requested=${result.requested}, hardDeleted=${result.hardDeleted}, skipped=${result.skipped}, mdmDisconnected=${result.mdmDisconnected}, mdmDisconnectFailed=${result.mdmDisconnectFailed})`,
      );
    } catch (error) {
      this.logger.error(`삭제 만료 하드삭제 tick 실패: ${String(error)}`);
    } finally {
      this.isRunning = false;
      const durationMs = Date.now() - startedAt;
      this.logger.log(`삭제 만료 하드삭제 tick 종료 (durationMs=${durationMs})`);
    }
  }
}
