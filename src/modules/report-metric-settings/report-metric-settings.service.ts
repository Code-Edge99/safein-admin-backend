import { randomUUID } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ReportMetricSettingsDto,
  ReportMetricSettingsResponseDto,
} from './dto/report-metric-settings.dto';

export type ReportMetricSettingsValues = Omit<ReportMetricSettingsResponseDto, 'updatedAt' | 'updatedByName'>;

const REPORT_METRIC_SETTING_KEY = 'report_metric_thresholds';
const MAX_INTEGER_DIGITS = 5;

const DEFAULT_REPORT_METRIC_SETTINGS: ReportMetricSettingsValues = {
  complianceAppBlockWeight: 1,
  complianceBehaviorBlockWeight: 1,
  complianceBadgeExcellentMin: 95,
  complianceBadgeGoodMin: 85,
  complianceBadgeFairMin: 70,
  siteRiskComplianceDangerBelow: 80,
  siteRiskComplianceWarningBelow: 90,
  siteRiskViolationsPerEmployeeDangerAbove: 1.5,
  siteRiskViolationsPerEmployeeWarningAbove: 0.7,
  siteRiskComplianceWeight: 1,
  siteRiskViolationsPerEmployeeWeight: 1,
  siteRiskDangerScoreMin: 60,
  siteRiskWarningScoreMin: 20,
};

type SystemSettingSchemaInfo = {
  idColumn?: string;
  keyColumn: string;
  valueColumn: string;
  valueColumnType: string;
  descriptionColumn?: string;
  updatedAtColumn?: string;
};

type RawSystemSettingRow = {
  value: unknown;
  updatedAt?: unknown;
};

@Injectable()
export class ReportMetricSettingsService {
  private systemSettingSchemaPromise?: Promise<SystemSettingSchemaInfo>;

  constructor(private readonly prisma: PrismaService) {}

  private quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  private getValueExpression(columnType: string, parameterIndex: number): string {
    const normalizedType = columnType.toLowerCase();

    if (normalizedType === 'jsonb') {
      return `$${parameterIndex}::jsonb`;
    }

    if (normalizedType === 'json') {
      return `$${parameterIndex}::json`;
    }

    return `$${parameterIndex}`;
  }

  private async getSystemSettingSchema(): Promise<SystemSettingSchemaInfo> {
    if (this.systemSettingSchemaPromise) {
      return this.systemSettingSchemaPromise;
    }

    this.systemSettingSchemaPromise = this.prisma.$queryRawUnsafe<Array<{
      column_name: string;
      data_type: string;
      udt_name: string;
    }>>(
      `
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'system_settings'
      `,
    ).then((rows) => {
      if (rows.length === 0) {
        throw new Error('system_settings 테이블을 찾을 수 없습니다.');
      }

      const pickColumn = (...candidates: string[]) => rows.find((row) => candidates.includes(row.column_name));
      const keyColumn = pickColumn('key')?.column_name;
      const valueColumnRow = pickColumn('value');

      if (!keyColumn || !valueColumnRow) {
        throw new Error('system_settings 테이블에 key/value 컬럼이 없습니다.');
      }

      return {
        idColumn: pickColumn('id')?.column_name,
        keyColumn,
        valueColumn: valueColumnRow.column_name,
        valueColumnType: valueColumnRow.udt_name || valueColumnRow.data_type,
        descriptionColumn: pickColumn('description')?.column_name,
        updatedAtColumn: pickColumn('updated_at', 'updatedAt')?.column_name,
      };
    }).catch((error) => {
      this.systemSettingSchemaPromise = undefined;
      throw error;
    });

    return this.systemSettingSchemaPromise;
  }

  private parseStoredValue(input: unknown): unknown {
    if (typeof input !== 'string') {
      return input;
    }

    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    const parsed = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async findStoredSetting(): Promise<RawSystemSettingRow | null> {
    const schema = await this.getSystemSettingSchema();
    const selectFields = [`${this.quoteIdentifier(schema.valueColumn)} AS value`];

    if (schema.updatedAtColumn) {
      selectFields.push(`${this.quoteIdentifier(schema.updatedAtColumn)} AS "updatedAt"`);
    }

    const rows = await this.prisma.$queryRawUnsafe<Array<RawSystemSettingRow>>(
      `
        SELECT ${selectFields.join(', ')}
        FROM "system_settings"
        WHERE ${this.quoteIdentifier(schema.keyColumn)} = $1
        LIMIT 1
      `,
      REPORT_METRIC_SETTING_KEY,
    );

    return rows[0] ?? null;
  }

  async findCurrentValues(): Promise<ReportMetricSettingsValues> {
    const setting = await this.findStoredSetting();

    return this.normalizeValues(setting?.value);
  }

  async findCurrent(): Promise<ReportMetricSettingsResponseDto> {
    const setting = await this.findStoredSetting();
    const values = this.normalizeValues(setting?.value);
    const meta = this.extractMeta(setting?.value);

    return {
      ...values,
      updatedAt: this.toDate(setting?.updatedAt),
      updatedByName: meta?.updatedByName ?? null,
    };
  }

  private async resolveActorName(actorId?: string): Promise<string | null> {
    if (!actorId) {
      return null;
    }

    const account = await this.prisma.account.findUnique({
      where: { id: actorId },
      select: { name: true, username: true },
    });

    return account?.name || account?.username || null;
  }

  private extractMeta(value: unknown): { updatedById: string | null; updatedByName: string | null } | null {
    const parsed = this.parseStoredValue(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const meta = (parsed as Record<string, unknown>).__meta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return null;
    }

    const normalizedMeta = meta as Record<string, unknown>;
    return {
      updatedById: typeof normalizedMeta.updatedById === 'string' ? normalizedMeta.updatedById : null,
      updatedByName: typeof normalizedMeta.updatedByName === 'string' ? normalizedMeta.updatedByName : null,
    };
  }

  async update(
    data: ReportMetricSettingsDto,
    actor: { id?: string },
  ): Promise<ReportMetricSettingsResponseDto> {
    this.ensureLogicalThresholds(data);

    const values = this.normalizeValues(data);
    const updatedByName = await this.resolveActorName(actor?.id);

    const schema = await this.getSystemSettingSchema();
    const description = '대시보드 및 리포트 산정 기준 설정';
    const serializedValue = JSON.stringify({
      ...values,
      __meta: {
        updatedById: actor?.id ?? null,
        updatedByName,
      },
    });
    const returningClause = schema.updatedAtColumn
      ? `${this.quoteIdentifier(schema.updatedAtColumn)} AS "updatedAt"`
      : 'NULL::timestamp AS "updatedAt"';

    const updateParams: unknown[] = [REPORT_METRIC_SETTING_KEY, serializedValue];
    const updateAssignments = [
      `${this.quoteIdentifier(schema.valueColumn)} = ${this.getValueExpression(schema.valueColumnType, 2)}`,
    ];

    if (schema.descriptionColumn) {
      updateParams.push(description);
      updateAssignments.push(`${this.quoteIdentifier(schema.descriptionColumn)} = $${updateParams.length}`);
    }

    if (schema.updatedAtColumn) {
      updateAssignments.push(`${this.quoteIdentifier(schema.updatedAtColumn)} = CURRENT_TIMESTAMP`);
    }

    const updatedRows = await this.prisma.$queryRawUnsafe<Array<{ updatedAt?: unknown }>>(
      `
        UPDATE "system_settings"
        SET ${updateAssignments.join(', ')}
        WHERE ${this.quoteIdentifier(schema.keyColumn)} = $1
        RETURNING ${returningClause}
      `,
      ...updateParams,
    );

    let setting = updatedRows[0];

    if (!setting) {
      const insertColumns: string[] = [];
      const insertValues: string[] = [];
      const insertParams: unknown[] = [];

      if (schema.idColumn) {
        insertColumns.push(this.quoteIdentifier(schema.idColumn));
        insertParams.push(randomUUID());
        insertValues.push(`$${insertParams.length}`);
      }

      insertColumns.push(this.quoteIdentifier(schema.keyColumn));
      insertParams.push(REPORT_METRIC_SETTING_KEY);
      insertValues.push(`$${insertParams.length}`);

      insertColumns.push(this.quoteIdentifier(schema.valueColumn));
      insertParams.push(serializedValue);
      insertValues.push(this.getValueExpression(schema.valueColumnType, insertParams.length));

      if (schema.descriptionColumn) {
        insertColumns.push(this.quoteIdentifier(schema.descriptionColumn));
        insertParams.push(description);
        insertValues.push(`$${insertParams.length}`);
      }

      if (schema.updatedAtColumn) {
        insertColumns.push(this.quoteIdentifier(schema.updatedAtColumn));
        insertValues.push('CURRENT_TIMESTAMP');
      }

      const insertedRows = await this.prisma.$queryRawUnsafe<Array<{ updatedAt?: unknown }>>(
        `
          INSERT INTO "system_settings" (${insertColumns.join(', ')})
          VALUES (${insertValues.join(', ')})
          RETURNING ${returningClause}
        `,
        ...insertParams,
      );

      setting = insertedRows[0];
    }

    return {
      ...values,
      updatedAt: this.toDate(setting?.updatedAt),
      updatedByName,
    };
  }

  private normalizeValues(input: unknown): ReportMetricSettingsValues {
    const parsedInput = this.parseStoredValue(input);
    const raw = (parsedInput && typeof parsedInput === 'object' && !Array.isArray(parsedInput) ? parsedInput : {}) as Partial<Record<keyof ReportMetricSettingsValues, unknown>>;

    return {
      complianceAppBlockWeight: this.readNumber(raw.complianceAppBlockWeight, DEFAULT_REPORT_METRIC_SETTINGS.complianceAppBlockWeight, 2),
      complianceBehaviorBlockWeight: this.readNumber(raw.complianceBehaviorBlockWeight, DEFAULT_REPORT_METRIC_SETTINGS.complianceBehaviorBlockWeight, 2),
      complianceBadgeExcellentMin: this.readNumber(raw.complianceBadgeExcellentMin, DEFAULT_REPORT_METRIC_SETTINGS.complianceBadgeExcellentMin, 2),
      complianceBadgeGoodMin: this.readNumber(raw.complianceBadgeGoodMin, DEFAULT_REPORT_METRIC_SETTINGS.complianceBadgeGoodMin, 2),
      complianceBadgeFairMin: this.readNumber(raw.complianceBadgeFairMin, DEFAULT_REPORT_METRIC_SETTINGS.complianceBadgeFairMin, 2),
      siteRiskComplianceDangerBelow: this.readNumber(raw.siteRiskComplianceDangerBelow, DEFAULT_REPORT_METRIC_SETTINGS.siteRiskComplianceDangerBelow, 2),
      siteRiskComplianceWarningBelow: this.readNumber(raw.siteRiskComplianceWarningBelow, DEFAULT_REPORT_METRIC_SETTINGS.siteRiskComplianceWarningBelow, 2),
      siteRiskViolationsPerEmployeeDangerAbove: this.readNumber(raw.siteRiskViolationsPerEmployeeDangerAbove, DEFAULT_REPORT_METRIC_SETTINGS.siteRiskViolationsPerEmployeeDangerAbove, 2),
      siteRiskViolationsPerEmployeeWarningAbove: this.readNumber(raw.siteRiskViolationsPerEmployeeWarningAbove, DEFAULT_REPORT_METRIC_SETTINGS.siteRiskViolationsPerEmployeeWarningAbove, 2),
      siteRiskComplianceWeight: this.readNumber(raw.siteRiskComplianceWeight, DEFAULT_REPORT_METRIC_SETTINGS.siteRiskComplianceWeight, 2),
      siteRiskViolationsPerEmployeeWeight: this.readNumber(raw.siteRiskViolationsPerEmployeeWeight, DEFAULT_REPORT_METRIC_SETTINGS.siteRiskViolationsPerEmployeeWeight, 2),
      siteRiskDangerScoreMin: this.readNumber(raw.siteRiskDangerScoreMin, DEFAULT_REPORT_METRIC_SETTINGS.siteRiskDangerScoreMin, 2),
      siteRiskWarningScoreMin: this.readNumber(raw.siteRiskWarningScoreMin, DEFAULT_REPORT_METRIC_SETTINGS.siteRiskWarningScoreMin, 2),
    };
  }

  private readNumber(value: unknown, fallback: number, decimals: number): number {
    const normalized = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    const factor = 10 ** decimals;
    return Math.round(normalized * factor) / factor;
  }

  private ensureLogicalThresholds(data: ReportMetricSettingsDto): void {
    this.ensureNumberPrecision(data);

    if (data.complianceAppBlockWeight <= 0 && data.complianceBehaviorBlockWeight <= 0) {
      throw new BadRequestException('안정 점수 계산식 가중치는 앱 또는 행동 중 하나 이상 0보다 커야 합니다.');
    }

    if (!(data.complianceBadgeExcellentMin > data.complianceBadgeGoodMin && data.complianceBadgeGoodMin > data.complianceBadgeFairMin)) {
      throw new BadRequestException('안정 점수 배지 구간은 우수 > 양호 > 보통 순서여야 합니다.');
    }

    if (data.siteRiskComplianceDangerBelow >= data.siteRiskComplianceWarningBelow) {
      throw new BadRequestException('현장 안정 점수 기준은 위험 미만 값이 주의 미만 값보다 작아야 합니다.');
    }

    if (data.siteRiskViolationsPerEmployeeDangerAbove <= data.siteRiskViolationsPerEmployeeWarningAbove) {
      throw new BadRequestException('직원 1인당 위반 기준은 위험 이상 값이 주의 이상 값보다 커야 합니다.');
    }

    if (data.siteRiskDangerScoreMin <= data.siteRiskWarningScoreMin) {
      throw new BadRequestException('현장 상태 점수 기준은 위험 점수가 주의 점수보다 커야 합니다.');
    }

    if (
      data.siteRiskComplianceWeight <= 0
      && data.siteRiskViolationsPerEmployeeWeight <= 0
    ) {
      throw new BadRequestException('현장 상태 점수는 최소 한 항목 이상 가중치가 0보다 커야 합니다.');
    }
  }

  private ensureNumberPrecision(data: ReportMetricSettingsDto): void {
    const entries = Object.entries(data) as Array<[keyof ReportMetricSettingsDto, unknown]>;

    entries.forEach(([key, value]) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return;
      }

      const [integerPart = '0', decimalPart = ''] = String(Math.abs(value)).split('.');
      if (integerPart.length > MAX_INTEGER_DIGITS || decimalPart.length > 2) {
        throw new BadRequestException(`${String(key)}는 정수부 5자리, 소수점 2자리까지만 입력할 수 있습니다.`);
      }
    });
  }
}
