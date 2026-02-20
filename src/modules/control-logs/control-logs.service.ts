import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    if (!organizationId || !scopeOrganizationIds) {
      return;
    }

    if (!scopeOrganizationIds.includes(organizationId)) {
      throw new ForbiddenException('요청한 조직은 접근 권한 범위를 벗어났습니다.');
    }
  }

  private applyScopeToWhere(where: any, scopeOrganizationIds?: string[]): void {
    if (!scopeOrganizationIds) {
      return;
    }

    where.employee = {
      ...(where.employee || {}),
      organizationId: { in: scopeOrganizationIds },
    };
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

  async create(createDto: CreateControlLogDto): Promise<ControlLogResponseDto> {
    const log = await this.prisma.controlLog.create({
      data: {
        employeeId: createDto.employeeId,
        deviceId: createDto.deviceId,
        policyId: createDto.policyId,
        zoneId: createDto.zoneId,
        type: createDto.type as any,
        action: createDto.action as any,
        timestamp: new Date(createDto.timestamp),
        latitude: createDto.latitude,
        longitude: createDto.longitude,
        reason: createDto.reason,
        appName: createDto.appName,
        packageName: createDto.packageName,
        behaviorDistance: createDto.behaviorDistance,
        behaviorSteps: createDto.behaviorSteps,
        behaviorSpeed: createDto.behaviorSpeed,
      },
      include: {
        employee: { select: { id: true, name: true } },
        device: { select: { id: true, deviceId: true } },
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
      where.employeeId = employeeId;
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
        where.timestamp.gte = new Date(startDate);
      }
      if (endDate) {
        where.timestamp.lte = new Date(endDate);
      }
    }

    if (organizationId) {
      this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);
      where.employee = {
        ...(where.employee || {}),
        organizationId,
      };
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
              name: true,
              organizationId: true,
              organization: { select: { id: true, name: true } },
            },
          },
          device: { select: { id: true, deviceId: true } },
          policy: { select: { id: true, name: true } },
          zone: { select: { id: true, name: true } },
        },
      }),
      this.prisma.controlLog.count({ where }),
    ]);

    return {
      data: logs.map((log) => this.toResponseDto(log)),
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
        device: { select: { id: true, deviceId: true } },
        policy: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
      },
    });

    if (!log) {
      throw new NotFoundException('제어 로그를 찾을 수 없습니다.');
    }

    if (scopeOrganizationIds && !scopeOrganizationIds.includes(log.employee.organizationId)) {
      throw new NotFoundException('제어 로그를 찾을 수 없습니다.');
    }

    return this.toResponseDto(log);
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
        where.timestamp.gte = new Date(startDate);
      }
      if (endDate) {
        where.timestamp.lte = new Date(endDate);
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
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyLogs = await this.prisma.controlLog.findMany({
      where: {
        timestamp: { gte: sevenDaysAgo },
        ...(scopeOrganizationIds
          ? {
              employee: {
                organizationId: { in: scopeOrganizationIds },
              },
            }
          : {}),
      },
      select: { timestamp: true },
    });

    const dailyMap = new Map<string, number>();
    dailyLogs.forEach((log) => {
      const dateStr = log.timestamp.toISOString().split('T')[0];
      dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + 1);
    });

    const dailyStats: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
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
      where.employee = { organizationId };
    } else if (scopeOrganizationIds) {
      where.employee = {
        organizationId: { in: scopeOrganizationIds },
      };
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
            ...(scopeOrganizationIds
              ? {
                  employee: {
                    organizationId: { in: scopeOrganizationIds },
                  },
                }
              : {}),
          },
        }),
        this.prisma.controlLog.findFirst({
          where: {
            employeeId: empLog.employeeId,
            ...(scopeOrganizationIds
              ? {
                  employee: {
                    organizationId: { in: scopeOrganizationIds },
                  },
                }
              : {}),
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
        ? {
            employee: {
              organizationId: { in: scopeOrganizationIds },
            },
          }
        : undefined,
      include: {
        employee: { select: { id: true, name: true } },
        device: { select: { id: true, deviceId: true } },
        policy: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
      },
    });

    return logs.map((log) => this.toResponseDto(log));
  }

  private toResponseDto(log: any): ControlLogResponseDto {
    return {
      id: log.id,
      type: log.type,
      action: log.action,
      timestamp: log.timestamp,
      latitude: log.latitude ? Number(log.latitude) : undefined,
      longitude: log.longitude ? Number(log.longitude) : undefined,
      reason: log.reason,
      appName: log.appName,
      packageName: log.packageName,
      behaviorDistance: log.behaviorDistance,
      behaviorSteps: log.behaviorSteps,
      behaviorSpeed: log.behaviorSpeed,
      employee: log.employee
        ? {
            id: log.employee.id,
            name: log.employee.name,
            organizationId: log.employee.organizationId || undefined,
            organizationName: log.employee.organization?.name || undefined,
          }
        : undefined,
      device: log.device,
      policy: log.policy,
      zone: log.zone,
      createdAt: log.createdAt,
    };
  }
}
