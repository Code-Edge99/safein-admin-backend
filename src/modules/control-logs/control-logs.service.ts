import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureOrganizationInScope } from '../../common/utils/organization-scope.util';
import { decryptLocation, encryptLocation } from '../../common/security/location-crypto';
import { formatKstDateKey, formatKstTimestampString, getKstDaysAgoStart, parseDateInputAsUtc } from '../../common/utils/kst-time.util';
import { resolveEmployeePrimaryId } from '../../common/utils/employee-identifier.util';
import { toControlLogResponseDto } from './control-logs.mapper';
import {
  CreateControlLogDto,
  ControlLogFilterDto,
  ControlLogResponseDto,
  ControlLogListResponseDto,
  ControlLogStatsDto,
  EmployeeLogStatsDto,
} from './dto';

@Injectable()
export class ControlLogsService {
  constructor(private prisma: PrismaService) {}

  private static readonly NON_REPORTABLE_EMPLOYEE_STATUSES = ['DELETE', 'PHONE_INFO_REVIEW'] as const;

  private async resolveAppNameMap(packageNames: string[]): Promise<Map<string, string>> {
    if (packageNames.length === 0) {
      return new Map();
    }

    const [installedApps, allowedApps] = await Promise.all([
      this.prisma.installedApp.findMany({
        where: { packageName: { in: packageNames } },
        select: { packageName: true, appName: true, lastDetectedAt: true },
        orderBy: { lastDetectedAt: 'desc' },
      }),
      this.prisma.allowedApp.findMany({
        where: { packageName: { in: packageNames } },
        select: { packageName: true, name: true },
      }),
    ]);

    const packageNameToAppName = new Map<string, string>();
    installedApps.forEach((app) => {
      if (!packageNameToAppName.has(app.packageName) && app.appName) {
        packageNameToAppName.set(app.packageName, app.appName);
      }
    });
    allowedApps.forEach((app) => {
      if (!packageNameToAppName.has(app.packageName) && app.name) {
        packageNameToAppName.set(app.packageName, app.name);
      }
    });

    return packageNameToAppName;
  }

  private async resolveLocationFallback(
    deviceId: string,
    timestamp: Date,
  ): Promise<{ latitude?: number; longitude?: number }> {
    const nearestLocation = await this.prisma.deviceLocation.findFirst({
      where: {
        deviceId,
        timestamp: { lte: timestamp },
      },
      orderBy: { timestamp: 'desc' },
    }) ?? await this.prisma.deviceLocation.findFirst({
      where: {
        deviceId,
        timestamp: { gte: timestamp },
      },
      orderBy: { timestamp: 'asc' },
    });

    if (!nearestLocation) {
      return {};
    }

    const location = decryptLocation(nearestLocation);
    return {
      latitude: location?.latitude,
      longitude: location?.longitude,
    };
  }

  private async enrichLogDtos(logs: any[]): Promise<ControlLogResponseDto[]> {
    const packageNames = Array.from(
      new Set(
        logs
          .filter((log) => !log.appName && log.packageName)
          .map((log) => log.packageName as string),
      ),
    );
    const packageNameToAppName = await this.resolveAppNameMap(packageNames);

    const dtos = await Promise.all(logs.map(async (log) => {
      const dto = this.toResponseDto(log);

      if (!dto.appName && dto.packageName) {
        dto.appName = packageNameToAppName.get(dto.packageName) || dto.packageName;
      }

      if ((dto.latitude === undefined || dto.longitude === undefined) && log.deviceId) {
        const fallbackLocation = await this.resolveLocationFallback(log.deviceId, log.timestamp);
        if (dto.latitude === undefined && fallbackLocation.latitude !== undefined) {
          dto.latitude = fallbackLocation.latitude;
        }
        if (dto.longitude === undefined && fallbackLocation.longitude !== undefined) {
          dto.longitude = fallbackLocation.longitude;
        }
      }

      return dto;
    }));

    return dtos;
  }

  private buildScopeCondition(scopeOrganizationIds: string[]) {
    return {
      OR: [
        { organizationId: { in: scopeOrganizationIds } },
        {
          AND: [
            { organizationId: null },
            { device: { organizationId: { in: scopeOrganizationIds } } },
          ],
        },
      ],
    };
  }

  private buildOrganizationCondition(organizationId: string) {
    return {
      OR: [
        { organizationId },
        {
          AND: [
            { organizationId: null },
            { device: { organizationId } },
          ],
        },
      ],
    };
  }

  private appendWhereCondition(where: any, condition: any): void {
    if (!where.AND) {
      where.AND = [];
    }

    where.AND.push(condition);
  }

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    ensureOrganizationInScope(organizationId, scopeOrganizationIds);
  }

  private applyScopeToWhere(where: any, scopeOrganizationIds?: string[]): void {
    if (!scopeOrganizationIds) {
      return;
    }

    this.appendWhereCondition(where, this.buildScopeCondition(scopeOrganizationIds));
  }

  private async resolveDeviceInternalId(rawDeviceId: string): Promise<string> {
    const matchedDevice = await this.prisma.device.findFirst({
      where: {
        OR: [{ id: rawDeviceId }, { deviceId: rawDeviceId }],
      },
      select: { id: true },
    });

    return matchedDevice?.id ?? rawDeviceId;
  }

  private async resolveDeviceContext(rawDeviceId: string): Promise<{ id: string; organizationId: string | null } | null> {
    const matchedDevice = await this.prisma.device.findFirst({
      where: {
        OR: [{ id: rawDeviceId }, { deviceId: rawDeviceId }],
      },
      select: { id: true, organizationId: true },
    });

    if (!matchedDevice) {
      return null;
    }

    return {
      id: matchedDevice.id,
      organizationId: matchedDevice.organizationId,
    };
  }

  async create(createDto: CreateControlLogDto): Promise<ControlLogResponseDto> {
    const resolvedDevice = await this.resolveDeviceContext(createDto.deviceId);
    const eventTimestamp = new Date(createDto.timestamp);
    if (Number.isNaN(eventTimestamp.getTime())) {
      throw new BadRequestException('timestamp는 유효한 UTC 기준 ISO 8601 날짜 형식이어야 합니다.');
    }
    const encryptedLocation = createDto.latitude !== undefined && createDto.longitude !== undefined
      ? encryptLocation({ latitude: createDto.latitude, longitude: createDto.longitude })
      : {
          locationCiphertext: null,
          locationIv: null,
          locationTag: null,
          locationKeyVersion: null,
        };

    const log = await this.prisma.controlLog.create({
      data: {
        employeeId: createDto.employeeId,
        deviceId: resolvedDevice?.id ?? createDto.deviceId,
        organizationId: resolvedDevice?.organizationId ?? null,
        policyId: createDto.policyId,
        zoneId: createDto.zoneId,
        type: createDto.type as any,
        action: createDto.action as any,
        originalTimestamp: createDto.timestamp,
        timestamp: eventTimestamp,
        timestampKst: formatKstTimestampString(eventTimestamp),
        ...encryptedLocation,
        reason: createDto.reason,
        appName: createDto.appName,
        packageName: createDto.packageName,
        behaviorDistance: createDto.behaviorDistance,
        behaviorSteps: createDto.behaviorSteps,
        behaviorSpeed: createDto.behaviorSpeed,
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            organization: { select: { id: true, name: true } },
          },
        },
        device: {
          select: {
            id: true,
            deviceId: true,
            organizationId: true,
            organization: { select: { id: true, name: true } },
          },
        },
        organization: { select: { id: true, name: true } },
        policy: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
      },
    });

    return this.toResponseDto(log);
  }

  async findAll(
    filter: ControlLogFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<ControlLogListResponseDto> {
    const {
      search,
      organizationId,
      employeeId,
      deviceId,
      policyId,
      zoneId,
      type,
      action,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = filter;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (employeeId) {
      const resolvedEmployeeId = await resolveEmployeePrimaryId(this.prisma, employeeId);
      if (!resolvedEmployeeId) {
        where.employeeId = '__missing_employee__';
      } else {
        const employee = await this.prisma.employee.findUnique({
          where: { id: resolvedEmployeeId },
          select: { status: true },
        });

        if (!employee || ControlLogsService.NON_REPORTABLE_EMPLOYEE_STATUSES.includes(String(employee.status) as any)) {
          where.employeeId = '__missing_employee__';
        } else {
          where.employeeId = resolvedEmployeeId;
        }
      }
    }

    if (deviceId) {
      where.deviceId = await this.resolveDeviceInternalId(deviceId);
    }

    if (policyId) {
      where.policyId = policyId;
    }

    if (zoneId) {
      where.zoneId = zoneId;
    }

    if (type) {
      where.type = type;
    }

    if (action) {
      where.action = action;
    }

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) {
        where.timestamp.gte = parseDateInputAsUtc(startDate, 'start');
      }
      if (endDate) {
        where.timestamp.lte = parseDateInputAsUtc(endDate, 'end');
      }
    }

    if (organizationId) {
      this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);
      this.appendWhereCondition(where, this.buildOrganizationCondition(organizationId));
    }

    if (search) {
      where.OR = [
        { reason: { contains: search, mode: 'insensitive' } },
        { appName: { contains: search, mode: 'insensitive' } },
        { packageName: { contains: search, mode: 'insensitive' } },
        { employee: { name: { contains: search, mode: 'insensitive' } } },
        { zone: { name: { contains: search, mode: 'insensitive' } } },
        { policy: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    this.applyScopeToWhere(where, scopeOrganizationIds);

    const [logs, total] = await Promise.all([
      this.prisma.controlLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' },
        include: {
          employee: {
            select: {
              id: true,
              referenceId: true,
              name: true,
              organizationId: true,
              organization: { select: { id: true, name: true } },
            },
          },
          device: {
            select: {
              id: true,
              deviceId: true,
              organizationId: true,
              organization: { select: { id: true, name: true } },
            },
          },
          organization: { select: { id: true, name: true } },
          policy: { select: { id: true, name: true } },
          zone: { select: { id: true, name: true } },
        },
      }),
      this.prisma.controlLog.count({ where }),
    ]);

    return {
      data: await this.enrichLogDtos(logs),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<ControlLogResponseDto> {
    const log = await this.prisma.controlLog.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            organization: { select: { id: true, name: true } },
          },
        },
        device: {
          select: {
            id: true,
            deviceId: true,
            organizationId: true,
            organization: { select: { id: true, name: true } },
          },
        },
        organization: { select: { id: true, name: true } },
        policy: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
      },
    });

    if (!log) {
      throw new NotFoundException('제어 로그를 찾을 수 없습니다.');
    }

    const logOrganizationId = (log as any).organizationId ?? log.device?.organizationId;
    if (scopeOrganizationIds && (!logOrganizationId || !scopeOrganizationIds.includes(logOrganizationId))) {
      throw new NotFoundException('제어 로그를 찾을 수 없습니다.');
    }

    return (await this.enrichLogDtos([log]))[0];
  }

  async findByEmployee(
    employeeId: string,
    filter: ControlLogFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<ControlLogListResponseDto> {
    return this.findAll({ ...filter, employeeId }, scopeOrganizationIds);
  }

  async findByDevice(
    deviceId: string,
    filter: ControlLogFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<ControlLogListResponseDto> {
    return this.findAll({ ...filter, deviceId }, scopeOrganizationIds);
  }

  async getStats(
    startDate?: string,
    endDate?: string,
    scopeOrganizationIds?: string[],
  ): Promise<ControlLogStatsDto> {
    const where: any = {};

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) {
        where.timestamp.gte = parseDateInputAsUtc(startDate, 'start');
      }
      if (endDate) {
        where.timestamp.lte = parseDateInputAsUtc(endDate, 'end');
      }
    }

    this.applyScopeToWhere(where, scopeOrganizationIds);

    const [totalLogs, blockedCount, allowedCount, byTypeResult] = await Promise.all([
      this.prisma.controlLog.count({ where }),
      this.prisma.controlLog.count({ where: { ...where, action: 'blocked' } }),
      this.prisma.controlLog.count({ where: { ...where, action: 'allowed' } }),
      this.prisma.controlLog.groupBy({
        by: ['type'],
        where,
        _count: { type: true },
      }),
    ]);

    const byType: Record<string, number> = {};
    byTypeResult.forEach((item) => {
      byType[item.type] = item._count.type;
    });

    // Get daily stats for last 7 days
    const sevenDaysAgo = getKstDaysAgoStart(6);

    const dailyLogs = await this.prisma.controlLog.findMany({
      where: {
        timestamp: { gte: sevenDaysAgo },
        ...(scopeOrganizationIds ? { AND: [this.buildScopeCondition(scopeOrganizationIds)] } : {}),
      },
      select: { timestamp: true },
    });

    const dailyMap = new Map<string, number>();
    dailyLogs.forEach((log) => {
      const dateStr = formatKstDateKey(log.timestamp);
      dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + 1);
    });

    const dailyStats: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = formatKstDateKey(date);
      dailyStats.push({
        date: dateStr,
        count: dailyMap.get(dateStr) || 0,
      });
    }

    return {
      totalLogs,
      blockedCount,
      allowedCount,
      byType,
      dailyStats,
    };
  }

  async getEmployeeStats(
    organizationId?: string,
    limit: number = 10,
    scopeOrganizationIds?: string[],
  ): Promise<EmployeeLogStatsDto[]> {
    const where: any = {};

    if (organizationId) {
      this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);
      this.appendWhereCondition(where, this.buildOrganizationCondition(organizationId));
    } else if (scopeOrganizationIds) {
      this.appendWhereCondition(where, this.buildScopeCondition(scopeOrganizationIds));
    }

    // Get employees with most logs
    const employeeLogs = await this.prisma.controlLog.groupBy({
      by: ['employeeId'],
      where,
      _count: { employeeId: true },
      orderBy: { _count: { employeeId: 'desc' } },
      take: limit,
    });

    const employeeIds = employeeLogs.map((e) => e.employeeId);

    // Get employee details
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, name: true },
    });

    const employeeMap = new Map(employees.map((e) => [e.id, e.name]));

    // Get blocked counts and last log times
    const stats: EmployeeLogStatsDto[] = [];

    for (const empLog of employeeLogs) {
      const [blockedCount, lastLog] = await Promise.all([
        this.prisma.controlLog.count({
          where: {
            employeeId: empLog.employeeId,
            action: 'blocked',
            ...(scopeOrganizationIds ? { AND: [this.buildScopeCondition(scopeOrganizationIds)] } : {}),
          },
        }),
        this.prisma.controlLog.findFirst({
          where: {
            employeeId: empLog.employeeId,
            ...(scopeOrganizationIds ? { AND: [this.buildScopeCondition(scopeOrganizationIds)] } : {}),
          },
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true },
        }),
      ]);

      stats.push({
        employeeId: empLog.employeeId,
        employeeName: employeeMap.get(empLog.employeeId) || 'Unknown',
        totalLogs: empLog._count.employeeId,
        blockedCount,
        lastLogAt: lastLog?.timestamp,
      });
    }

    return stats;
  }

  async getRecentLogs(
    limit: number = 20,
    scopeOrganizationIds?: string[],
  ): Promise<ControlLogResponseDto[]> {
    const logs = await this.prisma.controlLog.findMany({
      take: limit,
      orderBy: { timestamp: 'desc' },
      where: scopeOrganizationIds
        ? { AND: [this.buildScopeCondition(scopeOrganizationIds)] }
        : undefined,
      include: {
        employee: { select: { id: true, name: true } },
        device: {
          select: {
            id: true,
            deviceId: true,
            organizationId: true,
            organization: { select: { id: true, name: true } },
          },
        },
        organization: { select: { id: true, name: true } },
        policy: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
      },
    });

    return logs.map((log) => this.toResponseDto(log));
  }

  private toResponseDto(log: any): ControlLogResponseDto {
    return toControlLogResponseDto(log);
  }
}
