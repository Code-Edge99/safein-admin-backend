import { BadRequestException } from "@nestjs/common";
import { RequestBoardService } from "./request-board.service";

describe("RequestBoardService", () => {
  const updatedAt = new Date("2026-06-15T00:00:00.000Z");
  let prisma: {
    $transaction: jest.Mock;
    systemSetting: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let service: RequestBoardService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (callback) => callback(prisma)),
      systemSetting: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    service = new RequestBoardService(prisma as never);
  });

  it("returns an empty board when no setting exists", async () => {
    prisma.systemSetting.findUnique.mockResolvedValue(null);

    await expect(service.findCurrent("main-request-board")).resolves.toEqual({
      requests: [],
      devRows: [],
      updatedAt: null,
    });
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({
      where: { key: "dev_request_board:main-request-board" },
      select: {
        value: true,
        updatedAt: true,
      },
    });
  });

  it("upserts the normalized board into system settings", async () => {
    prisma.systemSetting.upsert.mockImplementation(async (args) => ({
      value: args.update.value,
      updatedAt,
    }));

    const result = await service.update("main-request-board", {
      requests: [
        {
          id: "req-1",
          text: "  [260615]   수정 요청  ",
          checked: true,
        },
      ],
      devRows: [
        {
          id: "row-1",
          date: " 26.06.15 ",
          devUpdated: true,
          devTested: false,
          prodUpdated: false,
          prodTested: false,
        },
      ],
    });

    const upsertArgs = prisma.systemSetting.upsert.mock.calls[0][0];

    expect(upsertArgs.where).toEqual({
      key: "dev_request_board:main-request-board",
    });
    expect(upsertArgs.update.description).toBe(
      "공용 요청사항 보드 (main-request-board)",
    );
    expect(upsertArgs.update.value).toEqual({
      requests: [
        {
          id: "req-1",
          text: "[260615] 수정 요청",
          checked: true,
        },
      ],
      devRows: [
        {
          id: "row-1",
          date: "26.06.15",
          devUpdated: true,
          devTested: false,
          prodUpdated: false,
          prodTested: false,
        },
      ],
    });
    expect(result.updatedAt).toBe(updatedAt);
  });

  it("uses the last known updatedAt to avoid overwriting newer board changes", async () => {
    const lastKnownUpdatedAt = "2026-06-14T12:00:00.000Z";

    prisma.systemSetting.updateMany.mockResolvedValue({ count: 1 });
    prisma.systemSetting.findUnique.mockResolvedValue({
      value: {
        requests: [],
        devRows: [],
      },
      updatedAt,
    });

    await expect(
      service.update("main-request-board", {
        requests: [],
        devRows: [],
        lastKnownUpdatedAt,
      }),
    ).resolves.toEqual({
      requests: [],
      devRows: [],
      updatedAt,
    });

    expect(prisma.systemSetting.updateMany).toHaveBeenCalledWith({
      where: {
        key: "dev_request_board:main-request-board",
        updatedAt: new Date(lastKnownUpdatedAt),
      },
      data: {
        value: {
          requests: [],
          devRows: [],
        },
        description: "공용 요청사항 보드 (main-request-board)",
      },
    });
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid board ids", async () => {
    await expect(service.findCurrent("../main")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
  });

  it("caps stored request and dev row arrays", async () => {
    prisma.systemSetting.upsert.mockImplementation(async (args) => ({
      value: args.update.value,
      updatedAt,
    }));

    await service.update("main-request-board", {
      requests: Array.from({ length: 205 }, (_, index) => ({
        id: `req-${index}`,
        text: `[260615] 요청 ${index}`,
        checked: false,
      })),
      devRows: Array.from({ length: 105 }, (_, index) => ({
        id: `row-${index}`,
        date: "26.06.15",
        devUpdated: false,
        devTested: false,
        prodUpdated: false,
        prodTested: false,
      })),
    });

    const upsertValue =
      prisma.systemSetting.upsert.mock.calls[0][0].update.value;

    expect(upsertValue.requests).toHaveLength(200);
    expect(upsertValue.devRows).toHaveLength(100);
  });
});
