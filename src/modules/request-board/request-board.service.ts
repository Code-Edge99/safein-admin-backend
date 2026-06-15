import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  REQUEST_BOARD_ID_PATTERN,
  REQUEST_BOARD_MAX_DEV_ROWS,
  REQUEST_BOARD_MAX_REQUESTS,
  RequestBoardDevRowDto,
  RequestBoardItemDto,
  RequestBoardResponseDto,
  RequestBoardUpdateDto,
} from "./dto/request-board.dto";

type RequestBoardValues = Pick<RequestBoardResponseDto, "requests" | "devRows">;
type StoredRequestBoardSetting = {
  value: Prisma.JsonValue;
  updatedAt: Date;
};

const REQUEST_BOARD_SETTING_PREFIX = "dev_request_board:";
const REQUEST_BOARD_SETTING_DESCRIPTION = "공용 요청사항 보드";

@Injectable()
export class RequestBoardService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitizeBoardId(boardId: string): string {
    const normalized = String(boardId ?? "").trim();

    if (
      !normalized ||
      normalized.length > 100 ||
      !REQUEST_BOARD_ID_PATTERN.test(normalized)
    ) {
      throw new BadRequestException("유효하지 않은 보드 ID입니다.");
    }

    return normalized;
  }

  private buildSettingKey(boardId: string): string {
    return `${REQUEST_BOARD_SETTING_PREFIX}${boardId}`;
  }

  private normalizeText(
    value: unknown,
    fallback: string,
    maxLength: number,
  ): string {
    const normalized = String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();

    return (normalized || fallback).slice(0, maxLength);
  }

  private parseDateValue(value: string): number | null {
    const normalized = String(value ?? "").trim();

    if (!normalized) {
      return null;
    }

    const matchedDate = normalized.match(
      /(20\d{2}|\d{2})[.\-/]?(\d{2})[.\-/]?(\d{2})/,
    );

    if (!matchedDate) {
      return null;
    }

    let year = Number(matchedDate[1]);
    const month = Number(matchedDate[2]);
    const day = Number(matchedDate[3]);

    if (year < 100) {
      year += 2000;
    }

    if (
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return null;
    }

    const parsedDate = new Date(Date.UTC(year, month - 1, day));

    if (
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day
    ) {
      return null;
    }

    return parsedDate.getTime();
  }

  private compareDateDesc(leftValue: string, rightValue: string): number {
    const leftDateValue = this.parseDateValue(leftValue);
    const rightDateValue = this.parseDateValue(rightValue);

    if (leftDateValue === rightDateValue) {
      return 0;
    }

    if (leftDateValue === null) {
      return 1;
    }

    if (rightDateValue === null) {
      return -1;
    }

    return rightDateValue - leftDateValue;
  }

  private sortBoard(values: RequestBoardValues): RequestBoardValues {
    values.requests.sort((leftItem, rightItem) =>
      this.compareDateDesc(leftItem.text, rightItem.text),
    );
    values.devRows.sort((leftItem, rightItem) =>
      this.compareDateDesc(leftItem.date, rightItem.date),
    );

    return values;
  }

  private normalizeBoard(input: unknown): RequestBoardValues {
    const record =
      input && typeof input === "object"
        ? (input as Record<string, unknown>)
        : {};
    const rawRequests = Array.isArray(record.requests)
      ? record.requests.slice(0, REQUEST_BOARD_MAX_REQUESTS)
      : [];
    const rawDevRows = Array.isArray(record.devRows)
      ? record.devRows.slice(0, REQUEST_BOARD_MAX_DEV_ROWS)
      : [];

    const requests: RequestBoardItemDto[] = rawRequests.map((item, index) => {
      const row =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};

      return {
        id: this.normalizeText(row.id, `request-${index + 1}`, 100),
        text: this.normalizeText(row.text, "새 요청사항", 500),
        checked: Boolean(row.checked),
      };
    });

    const devRows: RequestBoardDevRowDto[] = rawDevRows.map((item, index) => {
      const row =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};

      return {
        id: this.normalizeText(row.id, `row-${index + 1}`, 100),
        date: this.normalizeText(row.date, "새 날짜", 30),
        devUpdated: Boolean(row.devUpdated),
        devTested: Boolean(row.devTested ?? row.tested),
        prodUpdated: Boolean(row.prodUpdated),
        prodTested: Boolean(row.prodTested),
      };
    });

    return this.sortBoard({
      requests,
      devRows,
    });
  }

  private toPrismaJsonValue(value: RequestBoardValues): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private parseLastKnownUpdatedAt(
    value: string | null | undefined,
  ): Date | null {
    if (!value) {
      return null;
    }

    const parsedDate = new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException("마지막 조회 시각이 유효하지 않습니다.");
    }

    return parsedDate;
  }

  private buildSettingDescription(boardId: string): string {
    return `${REQUEST_BOARD_SETTING_DESCRIPTION} (${boardId})`;
  }

  private toResponse(
    setting: StoredRequestBoardSetting,
  ): RequestBoardResponseDto {
    return {
      ...this.normalizeBoard(setting.value),
      updatedAt: setting.updatedAt,
    };
  }

  private async updateWithLastKnownUpdatedAt(
    settingKey: string,
    value: RequestBoardValues,
    description: string,
    lastKnownUpdatedAt: Date,
  ): Promise<StoredRequestBoardSetting> {
    const jsonValue = this.toPrismaJsonValue(value);

    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.systemSetting.updateMany({
        where: {
          key: settingKey,
          updatedAt: lastKnownUpdatedAt,
        },
        data: {
          value: jsonValue,
          description,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException(
          "요청사항 보드가 다른 사용자에 의해 먼저 저장되었습니다. 새로고침 후 다시 저장해 주세요.",
        );
      }

      const setting = await tx.systemSetting.findUnique({
        where: { key: settingKey },
        select: {
          value: true,
          updatedAt: true,
        },
      });

      if (!setting) {
        throw new ConflictException(
          "요청사항 보드 저장 상태를 확인할 수 없습니다. 새로고침 후 다시 저장해 주세요.",
        );
      }

      return setting;
    });
  }

  async findCurrent(boardId: string): Promise<RequestBoardResponseDto> {
    const normalizedBoardId = this.sanitizeBoardId(boardId);
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: this.buildSettingKey(normalizedBoardId) },
      select: {
        value: true,
        updatedAt: true,
      },
    });

    if (!setting) {
      return {
        requests: [],
        devRows: [],
        updatedAt: null,
      };
    }

    return this.toResponse(setting);
  }

  async update(
    boardId: string,
    data: RequestBoardUpdateDto,
  ): Promise<RequestBoardResponseDto> {
    const normalizedBoardId = this.sanitizeBoardId(boardId);
    const settingKey = this.buildSettingKey(normalizedBoardId);
    const value = this.normalizeBoard(data);
    const description = this.buildSettingDescription(normalizedBoardId);
    const lastKnownUpdatedAt = this.parseLastKnownUpdatedAt(
      data.lastKnownUpdatedAt,
    );

    if (lastKnownUpdatedAt) {
      const setting = await this.updateWithLastKnownUpdatedAt(
        settingKey,
        value,
        description,
        lastKnownUpdatedAt,
      );

      return this.toResponse(setting);
    }

    const jsonValue = this.toPrismaJsonValue(value);
    const setting = await this.prisma.systemSetting.upsert({
      where: { key: settingKey },
      update: {
        value: jsonValue,
        description,
      },
      create: {
        key: settingKey,
        value: jsonValue,
        description,
      },
      select: {
        value: true,
        updatedAt: true,
      },
    });

    return this.toResponse(setting);
  }
}
