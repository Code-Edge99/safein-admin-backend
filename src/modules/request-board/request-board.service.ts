import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RequestBoardDevRowDto,
  RequestBoardItemDto,
  RequestBoardResponseDto,
  RequestBoardUpdateDto,
} from './dto/request-board.dto';

type RequestBoardValues = Omit<RequestBoardResponseDto, 'updatedAt'>;

const REQUEST_BOARD_SETTING_PREFIX = 'dev_request_board:';
const REQUEST_BOARD_SETTING_DESCRIPTION = '공용 요청사항 보드';

@Injectable()
export class RequestBoardService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitizeBoardId(boardId: string): string {
    const normalized = String(boardId ?? '').trim();

    if (!normalized || normalized.length > 100 || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(normalized)) {
      throw new BadRequestException('유효하지 않은 보드 ID입니다.');
    }

    return normalized;
  }

  private buildSettingKey(boardId: string): string {
    return `${REQUEST_BOARD_SETTING_PREFIX}${boardId}`;
  }

  private normalizeText(value: unknown, fallback: string, maxLength: number): string {
    const normalized = String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    return (normalized || fallback).slice(0, maxLength);
  }

  private parseDateValue(value: string): number | null {
    const normalized = String(value ?? '').trim();

    if (!normalized) {
      return null;
    }

    const matchedDate = normalized.match(/(20\d{2}|\d{2})[.\-/]?(\d{2})[.\-/]?(\d{2})/);

    if (!matchedDate) {
      return null;
    }

    let year = Number(matchedDate[1]);
    const month = Number(matchedDate[2]);
    const day = Number(matchedDate[3]);

    if (year < 100) {
      year += 2000;
    }

    if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
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
    values.requests.sort((leftItem, rightItem) => this.compareDateDesc(leftItem.text, rightItem.text));
    values.devRows.sort((leftItem, rightItem) => this.compareDateDesc(leftItem.date, rightItem.date));

    return values;
  }

  private normalizeBoard(input: unknown): RequestBoardValues {
    const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const rawRequests = Array.isArray(record.requests) ? record.requests : [];
    const rawDevRows = Array.isArray(record.devRows) ? record.devRows : [];

    const requests: RequestBoardItemDto[] = rawRequests.map((item, index) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};

      return {
        id: this.normalizeText(row.id, `request-${index + 1}`, 100),
        text: this.normalizeText(row.text, '새 요청사항', 500),
        checked: Boolean(row.checked),
      };
    });

    const devRows: RequestBoardDevRowDto[] = rawDevRows.map((item, index) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};

      return {
        id: this.normalizeText(row.id, `row-${index + 1}`, 100),
        date: this.normalizeText(row.date, '새 날짜', 30),
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

    return {
      ...this.normalizeBoard(setting.value),
      updatedAt: setting.updatedAt,
    };
  }

  async update(boardId: string, data: RequestBoardUpdateDto): Promise<RequestBoardResponseDto> {
    const normalizedBoardId = this.sanitizeBoardId(boardId);
    const value = this.normalizeBoard(data);
    const setting = await this.prisma.systemSetting.upsert({
      where: { key: this.buildSettingKey(normalizedBoardId) },
      update: {
        value: this.toPrismaJsonValue(value),
        description: `${REQUEST_BOARD_SETTING_DESCRIPTION} (${normalizedBoardId})`,
      },
      create: {
        key: this.buildSettingKey(normalizedBoardId),
        value: this.toPrismaJsonValue(value),
        description: `${REQUEST_BOARD_SETTING_DESCRIPTION} (${normalizedBoardId})`,
      },
      select: {
        value: true,
        updatedAt: true,
      },
    });

    return {
      ...this.normalizeBoard(setting.value),
      updatedAt: setting.updatedAt,
    };
  }
}