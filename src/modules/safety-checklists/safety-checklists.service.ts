import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AppLanguage,
  EmployeeStatus,
  Prisma,
  SafetyChecklistAssignmentStatus,
  SafetyChecklistDeploymentStatus,
  SafetyChecklistStatus,
  SafetyInspectionReviewStatus,
  TranslatableEntityType,
} from '@prisma/client';
import { ContentTranslationService } from '@/common/translation/translation.service';
import { resolveEmployeeDisplayName } from '../../common/utils/employee-display-name.util';
import { readStageConfig } from '../../common/config/stage.config';
import { resolveOrganizationClassification } from '../../common/utils/organization-scope.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateSafetyChecklistDeploymentDto,
  CreateSafetyChecklistDto,
  ReviewSafetyInspectionSubmissionDto,
  SafetyChecklistAssignmentDto,
  SafetyChecklistCandidateEmployeeDto,
  SafetyChecklistCandidateGroupDto,
  SafetyChecklistCandidateResponseDto,
  SafetyChecklistCandidateTeamDto,
  SafetyChecklistDeploymentDto,
  SafetyChecklistDetailDto,
  SafetyChecklistFilterDto,
  SafetyChecklistItemDto,
  SafetyChecklistListItemDto,
  SafetyChecklistListResponseDto,
  SafetyChecklistPatternsDto,
  SafetyChecklistPatternsFilterDto,
  SafetyChecklistPushMessageResultDto,
  SafetyChecklistSectionDto,
  SafetyChecklistStatisticsDto,
  SafetyChecklistStatisticsFilterDto,
  SafetyChecklistTodaySummaryDto,
  SafetyInspectionAnswerDto,
  SafetyInspectionSubmissionDetailDto,
  SafetyInspectionSubmissionFilterDto,
  SafetyInspectionSubmissionListItemDto,
  SafetyInspectionSubmissionListResponseDto,
  SendSafetyChecklistPushMessageDto,
  UpdateSafetyChecklistDto,
} from './dto';
import { buildContentDisposition, isSafetyInspectionImageFile, resolveSafetyInspectionStoredFilePath } from './safety-checklists.storage';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_DEPLOYMENT_DAYS = 366;

type OrganizationNode = {
  id: string;
  name: string;
  parentId: string | null;
  teamCode: string | null;
};

type OrganizationPath = {
  company: OrganizationNode | null;
  group: OrganizationNode | null;
  team: OrganizationNode | null;
};

type PrismaExecutor = PrismaService | Prisma.TransactionClient;

type ChecklistVersionWithSections = Prisma.SafetyChecklistVersionGetPayload<{
  include: {
    sections: {
      include: {
        items: true;
      };
    };
  };
}>;

type SafetyChecklistField = {
  fieldKey: string;
  content: string;
};

@Injectable()
export class SafetyChecklistsService {
  private readonly logger = new Logger(SafetyChecklistsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentTranslationService: ContentTranslationService,
    private readonly configService: ConfigService,
  ) {}

  async findCandidates(scopeOrganizationIds?: string[]): Promise<SafetyChecklistCandidateResponseDto> {
    const organizationMap = await this.getOrganizationMap(this.prisma);
    const employees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        status: EmployeeStatus.ACTIVE,
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      include: {
        organization: {
          select: { id: true, name: true, parentId: true, teamCode: true },
        },
      },
      orderBy: [{ organization: { name: 'asc' } }, { name: 'asc' }],
    });

    const groupsById = new Map<string, SafetyChecklistCandidateGroupDto>();
    const teamsByKey = new Map<string, SafetyChecklistCandidateTeamDto>();

    for (const employee of employees) {
      const path = this.resolveOrganizationPath(employee.organizationId, organizationMap);
      const ownOrg = employee.organization;
      const ownClassification = resolveOrganizationClassification(ownOrg);
      const group = path.group ?? (ownClassification === 'GROUP' ? ownOrg : null) ?? path.company ?? ownOrg;
      const team = path.team ?? (ownClassification === 'UNIT' ? ownOrg : null) ?? ownOrg;

      if (!groupsById.has(group.id)) {
        groupsById.set(group.id, { id: group.id, name: group.name, teams: [] });
      }

      const teamKey = `${group.id}:${team.id}`;
      if (!teamsByKey.has(teamKey)) {
        const teamDto: SafetyChecklistCandidateTeamDto = {
          id: team.id,
          name: team.name,
          employees: [],
        };
        teamsByKey.set(teamKey, teamDto);
        groupsById.get(group.id)!.teams.push(teamDto);
      }

      teamsByKey.get(teamKey)!.employees.push({
        id: employee.id,
        name: resolveEmployeeDisplayName(employee.name, employee.id),
        organizationId: employee.organizationId,
        organizationName: ownOrg.name,
        groupId: group.id,
        groupName: group.name,
        teamId: team.id,
        teamName: team.name,
        position: employee.position ?? null,
        role: employee.role ?? null,
      });
    }

    const groups = Array.from(groupsById.values()).map((group) => ({
      ...group,
      teams: group.teams.sort((left, right) => left.name.localeCompare(right.name)),
    })).sort((left, right) => left.name.localeCompare(right.name));

    return {
      groups,
      total: employees.length,
    };
  }

  async findAll(
    filter: SafetyChecklistFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyChecklistListResponseDto> {
    const page = Math.max(Number(filter.page || DEFAULT_PAGE), 1);
    const limit = Math.min(Math.max(Number(filter.limit || DEFAULT_LIMIT), 1), 100);
    const where = this.buildChecklistWhere(filter, scopeOrganizationIds);
    const today = this.parseDateOnly(this.getKstTodayString());

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.safetyChecklist.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true } },
          versions: {
            select: { id: true, version: true },
            orderBy: { version: 'desc' },
            take: 1,
          },
          deployments: {
            select: {
              createdAt: true,
              startDate: true,
              endDate: true,
              startTime: true,
              endTime: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          assignments: {
            where: { inspectionDate: today },
            select: {
              status: true,
              submission: { select: { id: true } },
            },
          },
          _count: {
            select: {
              deployments: true,
              assignments: true,
              submissions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.safetyChecklist.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.buildChecklistListItem(row)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<SafetyChecklistDetailDto> {
    const row = await this.prisma.safetyChecklist.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      include: {
        organization: { select: { id: true, name: true } },
        versions: {
          orderBy: { version: 'desc' },
          include: {
            sections: {
              orderBy: { sortOrder: 'asc' },
              include: {
                items: { orderBy: { sortOrder: 'asc' } },
              },
            },
          },
        },
        deployments: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            _count: { select: { assignments: true } },
          },
        },
        assignments: {
          orderBy: [{ inspectionDate: 'desc' }, { createdAt: 'desc' }],
          take: 100,
        },
        _count: {
          select: {
            deployments: true,
            assignments: true,
            submissions: true,
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundException('Safety checklist not found.');
    }

    const base = this.buildChecklistListItem(row);
    const version = this.pickCurrentVersion(row.versions, row.currentVersionId);

    return {
      ...base,
      sections: version ? this.buildSections(version) : [],
      deployments: row.deployments.map((deployment) => this.buildDeploymentDto(deployment)),
      assignments: row.assignments.map((assignment) => this.buildAssignmentDto(assignment)),
      todaySummary: await this.buildTodaySummary(row.id),
    };
  }

  async create(
    dto: CreateSafetyChecklistDto,
    scopeOrganizationIds: string[] | undefined,
    fallbackOrganizationId: string | undefined,
    actorId: string | undefined,
  ): Promise<SafetyChecklistDetailDto> {
    const organizationId = this.resolveOwnerOrganizationId(dto.organizationId, fallbackOrganizationId);
    this.assertOrganizationInScope(organizationId, scopeOrganizationIds);
    await this.assertOrganizationExists(organizationId);

    const normalizedSections = this.normalizeSections(dto.sections);
    const status = dto.status ?? SafetyChecklistStatus.ACTIVE;
    const targetEmployeeIds = this.uniqueStrings(dto.targetEmployeeIds ?? []);

    const createdResult = await this.prisma.$transaction(async (tx) => {
      const checklist = await tx.safetyChecklist.create({
        data: {
          organizationId,
          title: dto.title.trim(),
          description: dto.description ?? null,
          industry: dto.industry ?? null,
          sourceLanguage: AppLanguage.ko,
          status,
          createdById: actorId,
          updatedById: actorId,
        },
      });

      const version = await tx.safetyChecklistVersion.create({
        data: {
          checklistId: checklist.id,
          version: 1,
          title: checklist.title,
          description: checklist.description,
          industry: checklist.industry,
          sourceLanguage: checklist.sourceLanguage,
          createdById: actorId,
          sections: {
            create: this.buildSectionCreateData(normalizedSections),
          },
        },
      });

      await tx.safetyChecklist.update({
        where: { id: checklist.id },
        data: { currentVersionId: version.id },
      });

      let targetLanguages: AppLanguage[] = [];
      if (targetEmployeeIds.length > 0 && status !== SafetyChecklistStatus.DRAFT) {
        targetLanguages = await this.createDeploymentAndAssignments(tx, {
          checklistId: checklist.id,
          versionId: version.id,
          titleSnapshot: checklist.title,
          startDate: dto.startDate,
          endDate: dto.endDate,
          startTime: dto.startTime,
          endTime: dto.endTime,
          targetEmployeeIds,
          actorId,
          scopeOrganizationIds,
        });
      }

      return { checklistId: checklist.id, versionId: version.id, targetLanguages };
    });

    await this.queueSafetyChecklistVersionTranslations(createdResult.versionId, createdResult.targetLanguages);
    return this.findOne(createdResult.checklistId, scopeOrganizationIds);
  }

  async update(
    id: string,
    dto: UpdateSafetyChecklistDto,
    scopeOrganizationIds: string[] | undefined,
    actorId: string | undefined,
  ): Promise<SafetyChecklistDetailDto> {
    const existing = await this.prisma.safetyChecklist.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Safety checklist not found.');
    }

    const normalizedSections = dto.sections ? this.normalizeSections(dto.sections) : null;
    const targetEmployeeIds = dto.targetEmployeeIds === undefined ? undefined : this.uniqueStrings(dto.targetEmployeeIds);

    const updateResult = await this.prisma.$transaction(async (tx) => {
      let versionId = existing.currentVersionId ?? existing.versions[0]?.id ?? null;
      const nextTitle = dto.title?.trim() || existing.title;
      const nextDescription = dto.description === undefined ? existing.description : dto.description ?? null;
      const nextIndustry = dto.industry === undefined ? existing.industry : dto.industry ?? null;
      const nextStatus = dto.status ?? existing.status;

      if (normalizedSections) {
        const latestVersion = existing.versions[0]?.version ?? 0;
        const version = await tx.safetyChecklistVersion.create({
          data: {
            checklistId: existing.id,
            version: latestVersion + 1,
            title: nextTitle,
            description: nextDescription,
            industry: nextIndustry,
            sourceLanguage: existing.sourceLanguage ?? AppLanguage.ko,
            createdById: actorId,
            sections: {
              create: this.buildSectionCreateData(normalizedSections),
            },
          },
        });
        versionId = version.id;
      }

      await tx.safetyChecklist.update({
        where: { id: existing.id },
        data: {
          title: nextTitle,
          description: nextDescription,
          industry: nextIndustry,
          status: nextStatus,
          currentVersionId: versionId,
          updatedById: actorId,
        },
      });

      const shouldDeploy = nextStatus !== SafetyChecklistStatus.DRAFT
        && versionId
        && targetEmployeeIds !== undefined
        && targetEmployeeIds.length > 0;

      let targetLanguages: AppLanguage[] = [];
      if (shouldDeploy) {
        targetLanguages = await this.createDeploymentAndAssignments(tx, {
          checklistId: existing.id,
          versionId,
          titleSnapshot: nextTitle,
          startDate: dto.startDate,
          endDate: dto.endDate,
          startTime: dto.startTime,
          endTime: dto.endTime,
          targetEmployeeIds,
          actorId,
          scopeOrganizationIds,
        });
      }

      return { versionId, targetLanguages };
    });

    if (updateResult.versionId) {
      await this.queueSafetyChecklistVersionTranslations(updateResult.versionId, updateResult.targetLanguages);
    }

    return this.findOne(id, scopeOrganizationIds);
  }

  async deploy(
    id: string,
    dto: CreateSafetyChecklistDeploymentDto,
    scopeOrganizationIds: string[] | undefined,
    actorId: string | undefined,
  ): Promise<SafetyChecklistDetailDto> {
    const existing = await this.prisma.safetyChecklist.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
    });

    if (!existing) {
      throw new NotFoundException('Safety checklist not found.');
    }

    if (existing.status === SafetyChecklistStatus.ARCHIVED) {
      throw new BadRequestException('Archived checklists cannot be applied.');
    }

    if (!existing.currentVersionId) {
      throw new BadRequestException('Checklist version is missing.');
    }

    const hasTargetEmployees = Boolean(dto.targetEmployeeIds && dto.targetEmployeeIds.length > 0);
    if (!hasTargetEmployees) {
      throw new BadRequestException('At least one target employee is required.');
    }

    const targetLanguages = await this.prisma.$transaction(async (tx) => {
      const deploymentTargetLanguages = await this.createDeploymentAndAssignments(tx, {
        checklistId: existing.id,
        versionId: existing.currentVersionId!,
        titleSnapshot: existing.title,
        startDate: dto.startDate,
        endDate: dto.endDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
        targetEmployeeIds: this.uniqueStrings(dto.targetEmployeeIds ?? []),
        actorId,
        scopeOrganizationIds,
      });

      if (existing.status === SafetyChecklistStatus.DRAFT) {
        await tx.safetyChecklist.update({
          where: { id: existing.id },
          data: {
            status: SafetyChecklistStatus.ACTIVE,
            updatedById: actorId,
          },
        });
      }

      return deploymentTargetLanguages;
    });

    await this.queueSafetyChecklistVersionTranslations(existing.currentVersionId, targetLanguages);
    return this.findOne(id, scopeOrganizationIds);
  }

  async findSubmissions(
    filter: SafetyInspectionSubmissionFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyInspectionSubmissionListResponseDto> {
    if (filter.includeUnsubmitted) {
      return this.findAssignmentSubmissionStatuses(filter, scopeOrganizationIds);
    }

    const page = Math.max(Number(filter.page || DEFAULT_PAGE), 1);
    const limit = Math.min(Math.max(Number(filter.limit || DEFAULT_LIMIT), 1), 100);
    const where = this.buildSubmissionWhere(filter, scopeOrganizationIds);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.safetyInspectionSubmission.findMany({
        where,
        include: {
          checklist: { select: { id: true, title: true } },
          assignment: {
            select: {
              id: true,
              inspectionDate: true,
              organizationNameAtAssign: true,
              groupIdAtAssign: true,
              groupNameAtAssign: true,
              teamIdAtAssign: true,
              teamNameAtAssign: true,
              status: true,
            },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.safetyInspectionSubmission.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.buildSubmissionListItem(row)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private async findAssignmentSubmissionStatuses(
    filter: SafetyInspectionSubmissionFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyInspectionSubmissionListResponseDto> {
    const page = Math.max(Number(filter.page || DEFAULT_PAGE), 1);
    const limit = Math.min(Math.max(Number(filter.limit || DEFAULT_LIMIT), 1), 100);
    const where = this.buildAssignmentSubmissionWhere(filter, scopeOrganizationIds);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.safetyChecklistAssignment.findMany({
        where,
        include: {
          checklist: { select: { id: true, title: true } },
          submission: true,
        },
        orderBy: [
          { inspectionDate: 'desc' },
          { submittedAt: 'desc' },
          { employeeNameAtAssign: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.safetyChecklistAssignment.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.buildAssignmentSubmissionListItem(row)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findSubmissionDetail(
    id: string,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyInspectionSubmissionDetailDto> {
    const row = await this.prisma.safetyInspectionSubmission.findFirst({
      where: {
        id,
        ...(scopeOrganizationIds ? { checklist: { organizationId: { in: scopeOrganizationIds } } } : {}),
      },
      include: {
        checklist: { select: { id: true, title: true } },
        assignment: {
          select: {
            id: true,
            organizationNameAtAssign: true,
            groupIdAtAssign: true,
            groupNameAtAssign: true,
            teamIdAtAssign: true,
            teamNameAtAssign: true,
            inspectionDate: true,
            startedAt: true,
            dueAt: true,
            status: true,
          },
        },
        answers: {
          orderBy: { sortOrder: 'asc' },
          include: { attachments: true },
        },
      },
    });

    if (!row) {
      throw new NotFoundException('Inspection submission not found.');
    }

    return {
      ...this.buildSubmissionListItem(row),
      assignmentId: row.assignmentId,
      organizationNameAtAssign: row.assignment.organizationNameAtAssign,
      groupIdAtAssign: row.assignment.groupIdAtAssign,
      groupNameAtAssign: row.assignment.groupNameAtAssign,
      teamIdAtAssign: row.assignment.teamIdAtAssign,
      teamNameAtAssign: row.assignment.teamNameAtAssign,
      inspectionDate: row.assignment.inspectionDate,
      startedAt: row.assignment.startedAt,
      dueAt: row.assignment.dueAt,
      reviewComment: row.reviewComment ?? null,
      reviewedAt: row.reviewedAt ?? null,
      reviewedById: row.reviewedById ?? null,
      answers: row.answers.map((answer) => this.buildAnswerDto(answer)),
    };
  }

  async reviewSubmission(
    id: string,
    dto: ReviewSafetyInspectionSubmissionDto,
    scopeOrganizationIds: string[] | undefined,
    actorId: string | undefined,
  ): Promise<SafetyInspectionSubmissionDetailDto> {
    await this.findSubmissionDetail(id, scopeOrganizationIds);

    await this.prisma.safetyInspectionSubmission.update({
      where: { id },
      data: {
        reviewStatus: dto.reviewStatus,
        reviewComment: dto.reviewComment ?? null,
        reviewedAt: new Date(),
        reviewedById: actorId,
      },
    });

    return this.findSubmissionDetail(id, scopeOrganizationIds);
  }

  async sendTodayNonSubmitterPushMessage(
    id: string,
    dto: SendSafetyChecklistPushMessageDto,
    scopeOrganizationIds: string[] | undefined,
    actorAdminId?: string,
  ): Promise<SafetyChecklistPushMessageResultDto> {
    const checklist = await this.prisma.safetyChecklist.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      select: { id: true },
    });

    if (!checklist) {
      throw new NotFoundException('Safety checklist not found.');
    }

    const message = dto.message.trim();
    if (!message) {
      throw new BadRequestException('메시지를 입력해야 합니다.');
    }

    const sender = actorAdminId
      ? await this.prisma.account.findUnique({ where: { id: actorAdminId }, select: { name: true } })
      : null;

    return this.callAppBackendSafetyChecklistPush(id, {
      message,
      senderAdminId: actorAdminId,
      senderName: sender?.name,
    });
  }

  async sendAssignmentPushMessage(
    id: string,
    assignmentId: string,
    dto: SendSafetyChecklistPushMessageDto,
    scopeOrganizationIds: string[] | undefined,
    actorAdminId?: string,
  ): Promise<SafetyChecklistPushMessageResultDto> {
    const assignment = await this.prisma.safetyChecklistAssignment.findFirst({
      where: {
        id: assignmentId,
        checklistId: id,
        inspectionDate: this.parseDateOnly(this.getKstTodayString()),
        checklist: {
          deletedAt: null,
          ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
        },
      },
      select: {
        id: true,
        status: true,
        submission: { select: { id: true } },
      },
    });

    if (!assignment) {
      throw new NotFoundException('오늘 미제출 점검 대상을 찾을 수 없습니다.');
    }

    if (assignment.status === SafetyChecklistAssignmentStatus.SUBMITTED || assignment.submission) {
      throw new BadRequestException('이미 제출된 작업자에게는 미제출 알림을 발송할 수 없습니다.');
    }

    const message = dto.message.trim();
    if (!message) {
      throw new BadRequestException('메시지를 입력해야 합니다.');
    }

    const sender = actorAdminId
      ? await this.prisma.account.findUnique({ where: { id: actorAdminId }, select: { name: true } })
      : null;

    return this.callAppBackendSafetyChecklistPush(id, {
      message,
      senderAdminId: actorAdminId,
      senderName: sender?.name,
    }, assignmentId);
  }

  async getStatistics(
    filter: SafetyChecklistStatisticsFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyChecklistStatisticsDto> {
    const { dateFrom, dateTo } = this.resolveStatsRange(filter.dateFrom, filter.dateTo, 7);
    // inspectionDate는 @db.Date(UTC 자정)이므로 UTC 자정 경계를 사용한다.
    const from = this.parseDateOnly(dateFrom);
    const toExclusive = this.addDays(this.parseDateOnly(dateTo), 1);

    const assignments = await this.prisma.safetyChecklistAssignment.findMany({
      where: {
        inspectionDate: { gte: from, lt: toExclusive },
        ...(filter.checklistId ? { checklistId: filter.checklistId } : {}),
        ...(scopeOrganizationIds ? { checklist: { organizationId: { in: scopeOrganizationIds } } } : {}),
      },
      select: {
        inspectionDate: true,
        status: true,
        submission: { select: { xCount: true, reviewStatus: true } },
      },
    });

    // 출근 여부를 알 수 없어 제출률은 통계로서 의미가 없다.
    // 제출/미제출은 단순 건수(참고 표기)로만, 조치필요 응답·조치는 실제 제출 데이터 기반으로 집계한다.
    const dayBuckets = new Map<string, { submitted: number; xCount: number }>();
    for (const dateKey of this.enumerateDateStrings(dateFrom, dateTo)) {
      dayBuckets.set(dateKey, { submitted: 0, xCount: 0 });
    }

    let submittedCount = 0;
    let xResponseCount = 0;
    let pendingReviewCount = 0;
    let actionRequiredCount = 0;
    let actionCompletedCount = 0;

    for (const assignment of assignments) {
      const dateKey = this.formatDateOnly(assignment.inspectionDate);
      const dayBucket = dayBuckets.get(dateKey) ?? { submitted: 0, xCount: 0 };

      const isSubmitted = assignment.status === SafetyChecklistAssignmentStatus.SUBMITTED || Boolean(assignment.submission);
      if (isSubmitted) {
        submittedCount += 1;
        dayBucket.submitted += 1;
      }

      if (assignment.submission) {
        const { xCount, reviewStatus } = assignment.submission;
        xResponseCount += xCount;
        dayBucket.xCount += xCount;
        if (xCount > 0 && reviewStatus === SafetyInspectionReviewStatus.PENDING) pendingReviewCount += 1;
        if (
          xCount > 0
          && (
            reviewStatus === SafetyInspectionReviewStatus.PENDING
            || reviewStatus === SafetyInspectionReviewStatus.ACTION_REQUIRED
          )
        ) {
          actionRequiredCount += 1;
        }
        if (xCount > 0 && reviewStatus === SafetyInspectionReviewStatus.ACTION_COMPLETED) actionCompletedCount += 1;
      }

      dayBuckets.set(dateKey, dayBucket);
    }

    const totalAssignments = assignments.length;
    const actionTarget = actionRequiredCount + actionCompletedCount;

    return {
      dateFrom,
      dateTo,
      summary: {
        totalAssignments,
        submittedCount,
        notSubmittedCount: totalAssignments - submittedCount,
        xResponseCount,
        pendingReviewCount,
        actionRequiredCount,
        actionCompletedCount,
        actionCompletionRate: this.toRate(actionCompletedCount, actionTarget),
      },
      dailyTrend: Array.from(dayBuckets.entries()).map(([date, bucket]) => ({
        date,
        submitted: bucket.submitted,
        xCount: bucket.xCount,
      })),
    };
  }

  async getPatterns(
    filter: SafetyChecklistPatternsFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyChecklistPatternsDto> {
    const { dateFrom, dateTo } = this.resolveStatsRange(filter.dateFrom, filter.dateTo, 30);
    const scopeFilter = scopeOrganizationIds ? { checklist: { organizationId: { in: scopeOrganizationIds } } } : {};

    // 출근 여부를 알 수 없어 미제출은 통계로서 의미가 없으므로 반복 미제출 집계는 제공하지 않는다.
    // 실제 제출된 답변 기반의 반복 조치필요 응답 항목만 집계한다.
    // submittedAt은 timestamptz이므로 KST 경계를 사용한다.
    const submittedFrom = this.parseKstDateStart(dateFrom);
    const submittedToExclusive = this.addDays(this.parseKstDateStart(dateTo), 1);
    const answers = await this.prisma.safetyInspectionAnswer.findMany({
      where: {
        submission: {
          submittedAt: { gte: submittedFrom, lt: submittedToExclusive },
          ...(filter.checklistId ? { checklistId: filter.checklistId } : {}),
          ...scopeFilter,
        },
      },
      select: { question: true, sectionTitle: true, answer: true },
    });

    const itemBuckets = new Map<string, { question: string; section: string | null; x: number; total: number }>();
    for (const answer of answers) {
      const key = answer.question;
      const bucket = itemBuckets.get(key) ?? { question: answer.question, section: answer.sectionTitle, x: 0, total: 0 };
      bucket.total += 1;
      if (answer.answer === false) bucket.x += 1;
      itemBuckets.set(key, bucket);
    }

    const repeatXItems = Array.from(itemBuckets.values())
      .filter((bucket) => bucket.x > 0)
      .map((bucket) => ({
        question: bucket.question,
        section: bucket.section,
        xCount: bucket.x,
        totalCount: bucket.total,
        xRate: this.toRate(bucket.x, bucket.total),
      }))
      .sort((a, b) => b.xCount - a.xCount || b.xRate - a.xRate)
      .slice(0, 10);

    return { dateFrom, dateTo, repeatXItems };
  }

  private resolveStatsRange(
    dateFrom: string | undefined,
    dateTo: string | undefined,
    defaultSpanDays: number,
  ): { dateFrom: string; dateTo: string } {
    const resolvedTo = dateTo || this.getKstTodayString();
    const toStart = this.parseDateOnly(resolvedTo);
    const resolvedFrom = dateFrom || this.formatDateOnly(this.addDays(toStart, -(defaultSpanDays - 1)));
    const fromStart = this.parseDateOnly(resolvedFrom);

    if (fromStart > toStart) {
      throw new BadRequestException('endDate cannot be earlier than startDate.');
    }
    if (this.addDays(fromStart, MAX_DEPLOYMENT_DAYS) < toStart) {
      throw new BadRequestException('Date range is too long.');
    }

    return { dateFrom: resolvedFrom, dateTo: resolvedTo };
  }

  private enumerateDateStrings(dateFrom: string, dateTo: string): string[] {
    const result: string[] = [];
    let cursor = this.parseDateOnly(dateFrom);
    const end = this.parseDateOnly(dateTo);
    while (cursor <= end) {
      result.push(this.formatDateOnly(cursor));
      cursor = this.addDays(cursor, 1);
    }
    return result;
  }

  private toRate(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 1000) / 10;
  }

  private buildChecklistWhere(
    filter: SafetyChecklistFilterDto,
    scopeOrganizationIds?: string[],
  ): Prisma.SafetyChecklistWhereInput {
    const where: Prisma.SafetyChecklistWhereInput = {
      deletedAt: null,
      ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
    };

    if (filter.organizationId) {
      where.organizationId = filter.organizationId;
    }

    if (filter.status) {
      where.status = filter.status;
    }

    if (filter.search) {
      where.OR = [
        { title: { contains: filter.search, mode: 'insensitive' } },
        { description: { contains: filter.search, mode: 'insensitive' } },
        { industry: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private buildSubmissionWhere(
    filter: SafetyInspectionSubmissionFilterDto,
    scopeOrganizationIds?: string[],
  ): Prisma.SafetyInspectionSubmissionWhereInput {
    const where: Prisma.SafetyInspectionSubmissionWhereInput = {
      ...(scopeOrganizationIds ? { checklist: { organizationId: { in: scopeOrganizationIds } } } : {}),
    };

    if (filter.checklistId) {
      where.checklistId = filter.checklistId;
    }

    if (filter.reviewStatus) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        this.buildReviewStatusWhere(filter.reviewStatus),
      ];
    }

    const employeeName = filter.employeeName || filter.search;
    if (employeeName) {
      where.employeeNameAtSubmit = { contains: employeeName, mode: 'insensitive' };
    }

    if (filter.dateFrom || filter.dateTo) {
      where.submittedAt = {};
      if (filter.dateFrom) {
        where.submittedAt.gte = this.parseKstDateStart(filter.dateFrom);
      }
      if (filter.dateTo) {
        where.submittedAt.lt = this.addDays(this.parseKstDateStart(filter.dateTo), 1);
      }
    }

    return where;
  }

  private buildAssignmentSubmissionWhere(
    filter: SafetyInspectionSubmissionFilterDto,
    scopeOrganizationIds?: string[],
  ): Prisma.SafetyChecklistAssignmentWhereInput {
    const where: Prisma.SafetyChecklistAssignmentWhereInput = {
      ...(scopeOrganizationIds ? { checklist: { organizationId: { in: scopeOrganizationIds } } } : {}),
    };
    const and: Prisma.SafetyChecklistAssignmentWhereInput[] = [];

    if (filter.checklistId) {
      where.checklistId = filter.checklistId;
    }

    if (filter.reviewStatus) {
      and.push({ submission: { is: this.buildReviewStatusWhere(filter.reviewStatus) } });
    }

    const employeeName = filter.employeeName || filter.search;
    if (employeeName) {
      and.push({
        OR: [
          { employeeNameAtAssign: { contains: employeeName, mode: 'insensitive' } },
          { employeeIdAtAssign: { contains: employeeName, mode: 'insensitive' } },
          { organizationNameAtAssign: { contains: employeeName, mode: 'insensitive' } },
          { groupNameAtAssign: { contains: employeeName, mode: 'insensitive' } },
          { teamNameAtAssign: { contains: employeeName, mode: 'insensitive' } },
          { checklist: { title: { contains: employeeName, mode: 'insensitive' } } },
        ],
      });
    }

    if (filter.dateFrom || filter.dateTo) {
      where.inspectionDate = {};
      if (filter.dateFrom) {
        where.inspectionDate.gte = this.parseDateOnly(filter.dateFrom);
      }
      if (filter.dateTo) {
        where.inspectionDate.lte = this.parseDateOnly(filter.dateTo);
      }
    }

    if (and.length > 0) {
      where.AND = and;
    }

    return where;
  }

  private buildReviewStatusWhere(
    reviewStatus: SafetyInspectionReviewStatus,
  ): Prisma.SafetyInspectionSubmissionWhereInput {
    if (reviewStatus === SafetyInspectionReviewStatus.ACTION_REQUIRED) {
      return {
        OR: [
          { reviewStatus: SafetyInspectionReviewStatus.ACTION_REQUIRED },
          { reviewStatus: SafetyInspectionReviewStatus.PENDING, xCount: { gt: 0 } },
        ],
      };
    }

    if (reviewStatus === SafetyInspectionReviewStatus.CONFIRMED) {
      return {
        OR: [
          { reviewStatus: SafetyInspectionReviewStatus.CONFIRMED },
          { reviewStatus: SafetyInspectionReviewStatus.PENDING, xCount: 0 },
        ],
      };
    }

    return { reviewStatus };
  }

  private getAppBackendBaseUrl(): string {
    const baseUrl = readStageConfig(this.configService, 'APP_BACKEND_BASE_URL', {
      dev: 'http://localhost:3100/api/app',
      prod: 'https://safein.code-edge.com/api/app',
    });
    return baseUrl.trim().replace(/\/$/, '');
  }

  private resolveSafetyChecklistPushTimeoutMs(): number {
    const raw = this.configService.get<string>('SAFETY_CHECKLIST_PUSH_TIMEOUT_MS')?.trim()
      || this.configService.get<string>('TBM_PUSH_TIMEOUT_MS')?.trim();
    const parsed = raw ? Number(raw) : 7000;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 7000;
  }

  private async callAppBackendSafetyChecklistPush(
    checklistId: string,
    payload: {
      message: string;
      senderAdminId?: string;
      senderName?: string;
    },
    assignmentId?: string,
  ): Promise<SafetyChecklistPushMessageResultDto> {
    const encodedChecklistId = encodeURIComponent(checklistId);
    const endpointUrl = assignmentId
      ? `${this.getAppBackendBaseUrl()}/internal/safety-checklists/${encodedChecklistId}/assignments/${encodeURIComponent(assignmentId)}/push-message`
      : `${this.getAppBackendBaseUrl()}/internal/safety-checklists/${encodedChecklistId}/today-non-submitters/push-message`;
    const timeoutMs = this.resolveSafetyChecklistPushTimeoutMs();
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-smombie-source': 'admin-backend:safety_checklist_message',
        },
        signal: abortController.signal,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`status=${response.status}, body=${responseText || 'empty'}`);
      }

      return await response.json() as SafetyChecklistPushMessageResultDto;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`network-timeout>${timeoutMs}ms, endpoint=${endpointUrl}`);
      }

      this.logger.warn(`안전점검 미제출자 푸시 요청 실패(checklistId=${checklistId}): ${String(error)}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildChecklistListItem(row: {
    id: string;
    organizationId: string;
    organization: { name: string } | null;
    title: string;
    description: string | null;
    industry: string | null;
    status: SafetyChecklistStatus;
    currentVersionId: string | null;
    versions?: Array<{ version: number }>;
    deployments?: Array<{
      createdAt: Date;
      startDate: Date;
      endDate: Date | null;
      startTime: string;
      endTime: string;
    }>;
    assignments?: Array<{
      status: SafetyChecklistAssignmentStatus;
      submission?: { id: string } | null;
    }>;
    _count?: { deployments: number; assignments: number; submissions: number };
    createdAt: Date;
    updatedAt: Date;
  }): SafetyChecklistListItemDto {
    const latestDeployment = row.deployments?.[0] ?? null;
    const todayAssignments = (row.assignments ?? []).filter((assignment) => (
      Object.prototype.hasOwnProperty.call(assignment, 'submission')
    ));
    const todaySubmittedCount = todayAssignments.filter((assignment) => (
      assignment.status === SafetyChecklistAssignmentStatus.SUBMITTED || Boolean(assignment.submission)
    )).length;

    return {
      id: row.id,
      organizationId: row.organizationId,
      organizationName: row.organization?.name || '-',
      title: row.title,
      description: row.description ?? null,
      industry: row.industry ?? null,
      status: row.status,
      currentVersionId: row.currentVersionId,
      latestVersion: row.versions?.[0]?.version ?? null,
      latestDeploymentStartDate: latestDeployment?.startDate ?? null,
      latestDeploymentEndDate: latestDeployment?.endDate ?? null,
      latestDeploymentStartTime: latestDeployment?.startTime ?? null,
      latestDeploymentEndTime: latestDeployment?.endTime ?? null,
      todayTargetCount: todayAssignments.length,
      todaySubmittedCount,
      deploymentCount: Number(row._count?.deployments ?? 0),
      assignmentCount: Number(row._count?.assignments ?? 0),
      submissionCount: Number(row._count?.submissions ?? 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private pickCurrentVersion(
    versions: ChecklistVersionWithSections[],
    currentVersionId: string | null,
  ): ChecklistVersionWithSections | null {
    if (versions.length === 0) {
      return null;
    }

    if (currentVersionId) {
      return versions.find((version) => version.id === currentVersionId) ?? versions[0];
    }

    return versions[0];
  }

  private buildSections(version: ChecklistVersionWithSections): SafetyChecklistSectionDto[] {
    return version.sections.map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description ?? null,
      sortOrder: section.sortOrder,
      items: section.items.map((item): SafetyChecklistItemDto => ({
        id: item.id,
        category: item.category ?? null,
        question: item.question,
        helpText: item.helpText ?? null,
        required: item.required,
        sortOrder: item.sortOrder,
      })),
    }));
  }

  private buildDeploymentDto(deployment: {
    id: string;
    status: SafetyChecklistDeploymentStatus;
    titleSnapshot: string;
    startDate: Date;
    endDate: Date | null;
    startTime: string;
    endTime: string;
    createdAt: Date;
    _count?: { assignments: number };
  }): SafetyChecklistDeploymentDto {
    return {
      id: deployment.id,
      status: deployment.status,
      titleSnapshot: deployment.titleSnapshot,
      startDate: deployment.startDate,
      endDate: deployment.endDate ?? null,
      startTime: deployment.startTime,
      endTime: deployment.endTime,
      assignmentCount: Number(deployment._count?.assignments ?? 0),
      createdAt: deployment.createdAt,
    };
  }

  private buildAssignmentDto(assignment: {
    id: string;
    deploymentId: string;
    employeeId: string | null;
    employeeIdAtAssign: string;
    employeeNameAtAssign: string;
    organizationNameAtAssign: string | null;
    groupIdAtAssign: string | null;
    groupNameAtAssign: string | null;
    teamIdAtAssign: string | null;
    teamNameAtAssign: string | null;
    inspectionDate: Date;
    startedAt: Date | null;
    dueAt: Date | null;
    status: SafetyChecklistAssignmentStatus;
    submittedAt: Date | null;
  }): SafetyChecklistAssignmentDto {
    return {
      id: assignment.id,
      deploymentId: assignment.deploymentId,
      employeeId: assignment.employeeId ?? null,
      employeeIdAtAssign: assignment.employeeIdAtAssign,
      employeeNameAtAssign: resolveEmployeeDisplayName(assignment.employeeNameAtAssign, assignment.employeeIdAtAssign),
      organizationNameAtAssign: assignment.organizationNameAtAssign ?? null,
      groupIdAtAssign: assignment.groupIdAtAssign ?? null,
      groupNameAtAssign: assignment.groupNameAtAssign ?? null,
      teamIdAtAssign: assignment.teamIdAtAssign ?? null,
      teamNameAtAssign: assignment.teamNameAtAssign ?? null,
      inspectionDate: assignment.inspectionDate,
      startedAt: assignment.startedAt ?? null,
      dueAt: assignment.dueAt ?? null,
      status: assignment.status,
      submittedAt: assignment.submittedAt ?? null,
    };
  }

  private async buildTodaySummary(checklistId: string): Promise<SafetyChecklistTodaySummaryDto> {
    const today = this.getKstTodayString();
    const assignments = await this.prisma.safetyChecklistAssignment.findMany({
      where: {
        checklistId,
        inspectionDate: this.parseDateOnly(today),
      },
      orderBy: [{ submittedAt: 'desc' }, { employeeNameAtAssign: 'asc' }],
      select: {
        id: true,
        employeeId: true,
        employeeIdAtAssign: true,
        employeeNameAtAssign: true,
        organizationNameAtAssign: true,
        status: true,
        submittedAt: true,
        submission: {
          select: {
            xCount: true,
            reviewStatus: true,
          },
        },
      },
    });

    let submittedCount = 0;
    let normalSubmittedCount = 0;
    let actionNeededCount = 0;
    let actionCompletedCount = 0;
    let pendingCount = 0;
    let inProgressCount = 0;
    let overdueCount = 0;

    for (const assignment of assignments) {
      const submitted = assignment.status === SafetyChecklistAssignmentStatus.SUBMITTED || Boolean(assignment.submission);
      const actionNeeded = Boolean(
        assignment.submission
        && assignment.submission.xCount > 0
        && assignment.submission.reviewStatus !== SafetyInspectionReviewStatus.ACTION_COMPLETED,
      );

      if (submitted) {
        submittedCount += 1;
        if ((assignment.submission?.xCount ?? 0) === 0) {
          normalSubmittedCount += 1;
        }
      }

      if (actionNeeded) {
        actionNeededCount += 1;
      }

      if (
        assignment.submission
        && assignment.submission.xCount > 0
        && assignment.submission.reviewStatus === SafetyInspectionReviewStatus.ACTION_COMPLETED
      ) {
        actionCompletedCount += 1;
      }

      if (!submitted && assignment.status === SafetyChecklistAssignmentStatus.PENDING) pendingCount += 1;
      if (!submitted && assignment.status === SafetyChecklistAssignmentStatus.IN_PROGRESS) inProgressCount += 1;
      if (!submitted && assignment.status === SafetyChecklistAssignmentStatus.OVERDUE) overdueCount += 1;
    }

    return {
      date: today,
      targetCount: assignments.length,
      submittedCount,
      normalSubmittedCount,
      actionNeededCount,
      actionCompletedCount,
      notSubmittedCount: assignments.length - submittedCount,
      pendingCount,
      inProgressCount,
      overdueCount,
      targets: assignments
        .map((assignment) => ({
          assignmentId: assignment.id,
          employeeId: assignment.employeeId ?? assignment.employeeIdAtAssign,
          employeeName: resolveEmployeeDisplayName(assignment.employeeNameAtAssign, assignment.employeeIdAtAssign),
          organizationName: assignment.organizationNameAtAssign ?? null,
          status: assignment.status,
          submitted: assignment.status === SafetyChecklistAssignmentStatus.SUBMITTED || Boolean(assignment.submission),
          submittedAt: assignment.submittedAt ?? null,
          actionNeeded: Boolean(
            assignment.submission
            && assignment.submission.xCount > 0
            && assignment.submission.reviewStatus !== SafetyInspectionReviewStatus.ACTION_COMPLETED,
          ),
          actionCompleted: Boolean(
            assignment.submission
            && assignment.submission.xCount > 0
            && assignment.submission.reviewStatus === SafetyInspectionReviewStatus.ACTION_COMPLETED,
          ),
        })),
    };
  }

  private buildSubmissionListItem(row: {
    id: string;
    assignmentId: string;
    checklistId: string;
    checklist: { title: string };
    employeeId: string | null;
    employeeIdAtSubmit: string;
    employeeNameAtSubmit: string;
    reviewStatus: SafetyInspectionReviewStatus;
    oCount: number;
    xCount: number;
    submittedAt: Date;
    assignment?: {
      id: string;
      inspectionDate: Date;
      organizationNameAtAssign: string | null;
      groupIdAtAssign: string | null;
      groupNameAtAssign: string | null;
      teamIdAtAssign: string | null;
      teamNameAtAssign: string | null;
      status: SafetyChecklistAssignmentStatus;
    } | null;
  }): SafetyInspectionSubmissionListItemDto {
    return {
      id: row.id,
      assignmentId: row.assignment?.id ?? row.assignmentId,
      checklistId: row.checklistId,
      checklistTitle: row.checklist.title,
      employeeId: row.employeeId ?? null,
      employeeIdAtSubmit: row.employeeIdAtSubmit,
      employeeNameAtSubmit: resolveEmployeeDisplayName(row.employeeNameAtSubmit, row.employeeIdAtSubmit),
      organizationNameAtAssign: row.assignment?.organizationNameAtAssign ?? null,
      groupIdAtAssign: row.assignment?.groupIdAtAssign ?? null,
      groupNameAtAssign: row.assignment?.groupNameAtAssign ?? null,
      teamIdAtAssign: row.assignment?.teamIdAtAssign ?? null,
      teamNameAtAssign: row.assignment?.teamNameAtAssign ?? null,
      inspectionDate: row.assignment?.inspectionDate ?? null,
      assignmentStatus: row.assignment?.status ?? SafetyChecklistAssignmentStatus.SUBMITTED,
      submitted: true,
      reviewStatus: row.reviewStatus,
      oCount: row.oCount,
      xCount: row.xCount,
      submittedAt: row.submittedAt,
    };
  }

  private buildAssignmentSubmissionListItem(row: {
    id: string;
    checklistId: string;
    checklist: { title: string };
    employeeId: string | null;
    employeeIdAtAssign: string;
    employeeNameAtAssign: string;
    organizationNameAtAssign: string | null;
    groupIdAtAssign: string | null;
    groupNameAtAssign: string | null;
    teamIdAtAssign: string | null;
    teamNameAtAssign: string | null;
    inspectionDate: Date;
    status: SafetyChecklistAssignmentStatus;
    submittedAt: Date | null;
    submission?: {
      id: string;
      employeeId: string | null;
      employeeIdAtSubmit: string;
      employeeNameAtSubmit: string;
      reviewStatus: SafetyInspectionReviewStatus;
      oCount: number;
      xCount: number;
      submittedAt: Date;
    } | null;
  }): SafetyInspectionSubmissionListItemDto {
    const submission = row.submission ?? null;

    return {
      id: submission?.id ?? row.id,
      assignmentId: row.id,
      checklistId: row.checklistId,
      checklistTitle: row.checklist.title,
      employeeId: submission?.employeeId ?? row.employeeId ?? null,
      employeeIdAtSubmit: submission?.employeeIdAtSubmit ?? row.employeeIdAtAssign,
      employeeNameAtSubmit: resolveEmployeeDisplayName(
        submission?.employeeNameAtSubmit ?? row.employeeNameAtAssign,
        submission?.employeeIdAtSubmit ?? row.employeeIdAtAssign,
      ),
      organizationNameAtAssign: row.organizationNameAtAssign ?? null,
      groupIdAtAssign: row.groupIdAtAssign ?? null,
      groupNameAtAssign: row.groupNameAtAssign ?? null,
      teamIdAtAssign: row.teamIdAtAssign ?? null,
      teamNameAtAssign: row.teamNameAtAssign ?? null,
      inspectionDate: row.inspectionDate,
      assignmentStatus: row.status,
      submitted: Boolean(submission),
      reviewStatus: submission?.reviewStatus ?? null,
      oCount: submission?.oCount ?? 0,
      xCount: submission?.xCount ?? 0,
      submittedAt: submission?.submittedAt ?? null,
    };
  }

  private buildAnswerDto(answer: {
    id: string;
    itemId: string | null;
    sectionTitle: string | null;
    category: string | null;
    question: string;
    answer: SafetyInspectionAnswerDto['answer'];
    actionText: string | null;
    sortOrder: number;
    attachments: Array<{
      id: string;
      originalName: string;
      mimeType: string;
      size: number;
      createdAt: Date;
    }>;
  }): SafetyInspectionAnswerDto {
    return {
      id: answer.id,
      itemId: answer.itemId ?? null,
      sectionTitle: answer.sectionTitle ?? null,
      category: answer.category ?? null,
      question: answer.question,
      answer: answer.answer,
      actionText: answer.actionText ?? null,
      sortOrder: answer.sortOrder,
      attachments: answer.attachments.map((attachment) => ({
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        isImage: isSafetyInspectionImageFile(attachment),
        downloadUrl: `/api/safety-checklists/answers/${answer.id}/attachments/${attachment.id}/download`,
        createdAt: attachment.createdAt,
      })),
    };
  }

  async resolveAttachmentFileTarget(
    answerId: string,
    attachmentId: string,
    scopeOrganizationIds: string[] | undefined,
  ): Promise<{
    absolutePath: string;
    mimeType: string;
    originalName: string;
    isImage: boolean;
  }> {
    const attachment = await this.prisma.safetyInspectionAttachment.findFirst({
      where: {
        id: attachmentId,
        answerId,
        ...(scopeOrganizationIds
          ? { answer: { submission: { checklist: { organizationId: { in: scopeOrganizationIds } } } } }
          : {}),
      },
    });

    if (!attachment) {
      throw new NotFoundException('첨부파일을 찾을 수 없습니다.');
    }

    const absolutePath = await resolveSafetyInspectionStoredFilePath(attachment.storagePath || attachment.fileName);
    if (!absolutePath) {
      throw new NotFoundException('첨부파일을 찾을 수 없습니다.');
    }

    return {
      absolutePath,
      mimeType: attachment.mimeType,
      originalName: attachment.originalName,
      isImage: isSafetyInspectionImageFile(attachment),
    };
  }

  buildContentDisposition(fileName: string, isInline: boolean): string {
    return buildContentDisposition(fileName, isInline);
  }

  private normalizeSections(sections: CreateSafetyChecklistDto['sections']): CreateSafetyChecklistDto['sections'] {
    return sections.map((section, sectionIndex) => {
      const title = section.title.trim();
      if (!title) {
        throw new BadRequestException('Section title is required.');
      }

      return {
        ...section,
        title,
        sortOrder: section.sortOrder ?? sectionIndex,
        items: section.items.map((item, itemIndex) => {
          const question = item.question.trim();
          if (!question) {
            throw new BadRequestException('Checklist question is required.');
          }

          return {
            ...item,
            question,
            sortOrder: item.sortOrder ?? itemIndex,
            required: item.required ?? true,
          };
        }),
      };
    });
  }

  private buildSectionCreateData(
    sections: CreateSafetyChecklistDto['sections'],
  ): Prisma.SafetyChecklistSectionCreateWithoutVersionInput[] {
    return sections.map((section) => ({
      title: section.title,
      description: section.description ?? null,
      sortOrder: section.sortOrder ?? 0,
      items: {
        create: section.items.map((item) => ({
          category: item.category ?? null,
          question: item.question,
          helpText: item.helpText ?? null,
          required: item.required ?? true,
          sortOrder: item.sortOrder ?? 0,
        })),
      },
    }));
  }

  private buildSourceFields(version: {
    title: string;
    description: string | null;
    industry: string | null;
    sections: Array<{
      title: string;
      description: string | null;
      items: Array<{
        category: string | null;
        question: string;
        helpText: string | null;
      }>;
    }>;
  }): SafetyChecklistField[] {
    const fields: SafetyChecklistField[] = [
      { fieldKey: 'title', content: version.title },
      { fieldKey: 'description', content: version.description ?? '' },
      { fieldKey: 'industry', content: version.industry ?? '' },
    ];

    version.sections.forEach((section, sectionIndex) => {
      fields.push({ fieldKey: `sections.${sectionIndex}.title`, content: section.title });
      fields.push({ fieldKey: `sections.${sectionIndex}.description`, content: section.description ?? '' });
      section.items.forEach((item, itemIndex) => {
        fields.push({ fieldKey: `sections.${sectionIndex}.items.${itemIndex}.category`, content: item.category ?? '' });
        fields.push({ fieldKey: `sections.${sectionIndex}.items.${itemIndex}.question`, content: item.question });
        fields.push({ fieldKey: `sections.${sectionIndex}.items.${itemIndex}.helpText`, content: item.helpText ?? '' });
      });
    });

    return fields.filter((field) => field.content.trim().length > 0);
  }

  private async queueSafetyChecklistVersionTranslations(
    versionId: string,
    targetLanguages: AppLanguage[],
  ): Promise<void> {
    const version = await this.prisma.safetyChecklistVersion.findUnique({
      where: { id: versionId },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            items: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });

    if (!version) {
      return;
    }

    const sourceLanguage = version.sourceLanguage ?? AppLanguage.ko;
    const normalizedTargets = Array.from(new Set(targetLanguages)).filter((language) => language !== sourceLanguage);
    if (normalizedTargets.length === 0) {
      return;
    }

    this.contentTranslationService.queueTranslationsFromKorean({
      entityType: TranslatableEntityType.SAFETY_CHECKLIST,
      entityId: version.id,
      sourceUpdatedAt: version.createdAt,
      fields: this.buildSourceFields(version),
      skipLanguages: [sourceLanguage],
    });
  }

  private async createDeploymentAndAssignments(
    tx: Prisma.TransactionClient,
    input: {
      checklistId: string;
      versionId: string;
      titleSnapshot: string;
      startDate?: string;
      endDate?: string;
      startTime?: string;
      endTime?: string;
      targetEmployeeIds: string[];
      actorId?: string;
      scopeOrganizationIds?: string[];
    },
  ): Promise<AppLanguage[]> {
    const startDateString = input.startDate ?? this.getKstTodayString();
    const startDate = this.parseDateOnly(startDateString);
    const endDate = input.endDate ? this.parseDateOnly(input.endDate) : startDate;
    const dates = this.getDateRange(startDate, endDate);
    const startTime = input.startTime ?? '09:00';
    const endTime = input.endTime ?? '17:00';
    this.assertTimeRange(startTime, endTime);
    const organizationMap = await this.getOrganizationMap(tx);
    const employees = await this.findAssignableEmployees(tx, input.targetEmployeeIds, input.scopeOrganizationIds);

    if (employees.length === 0) {
      throw new BadRequestException('적용 가능한 활성 직원이 없습니다.');
    }

    const deployment = await tx.safetyChecklistDeployment.create({
      data: {
        checklistId: input.checklistId,
        versionId: input.versionId,
        titleSnapshot: input.titleSnapshot,
        status: SafetyChecklistDeploymentStatus.ACTIVE,
        startDate,
        endDate,
        startTime,
        endTime,
        createdById: input.actorId,
      },
    });

    const assignmentRows: Prisma.SafetyChecklistAssignmentCreateManyInput[] = [];
    for (const employee of employees) {
      const path = this.resolveOrganizationPath(employee.organizationId, organizationMap);
      const ownClassification = resolveOrganizationClassification(employee.organization);
      const group = path.group ?? (ownClassification === 'GROUP' ? employee.organization : null);
      const team = path.team ?? (ownClassification === 'UNIT' ? employee.organization : null);

      for (const date of dates) {
        const dateString = this.formatDateOnly(date);
        assignmentRows.push({
          deploymentId: deployment.id,
          checklistId: input.checklistId,
          versionId: input.versionId,
          employeeId: employee.id,
          employeeIdAtAssign: employee.id,
          employeeNameAtAssign: employee.name,
          employeeStatusAtAssign: employee.status,
          positionAtAssign: employee.position ?? null,
          roleAtAssign: employee.role ?? null,
          organizationIdAtAssign: employee.organizationId,
          organizationNameAtAssign: employee.organization.name,
          groupIdAtAssign: group?.id ?? null,
          groupNameAtAssign: group?.name ?? null,
          teamIdAtAssign: team?.id ?? null,
          teamNameAtAssign: team?.name ?? null,
          languageAtAssigned: employee.employeeAccount?.preferredLanguage ?? AppLanguage.ko,
          inspectionDate: date,
          startedAt: this.combineKstDateTime(dateString, startTime),
          dueAt: this.combineKstDateTime(dateString, endTime),
          status: SafetyChecklistAssignmentStatus.PENDING,
        });
      }
    }

    if (assignmentRows.length > 0) {
      await tx.safetyChecklistAssignment.createMany({
        data: assignmentRows,
        skipDuplicates: true,
      });
    }

    return Array.from(new Set(employees.map((employee) => employee.employeeAccount?.preferredLanguage ?? AppLanguage.ko)));
  }

  private async findAssignableEmployees(
    tx: Prisma.TransactionClient,
    employeeIds: string[],
    scopeOrganizationIds?: string[],
  ) {
    const uniqueEmployeeIds = this.uniqueStrings(employeeIds);
    if (uniqueEmployeeIds.length === 0) {
      throw new BadRequestException('At least one target employee is required.');
    }

    const employees = await tx.employee.findMany({
      where: {
        id: { in: uniqueEmployeeIds },
        deletedAt: null,
        status: EmployeeStatus.ACTIVE,
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      include: {
        organization: {
          select: { id: true, name: true, parentId: true, teamCode: true },
        },
        employeeAccount: {
          select: { preferredLanguage: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    if (employees.length !== uniqueEmployeeIds.length) {
      throw new BadRequestException('Some target employees are inactive, deleted, or outside the organization scope.');
    }

    return employees;
  }

  private resolveOwnerOrganizationId(requestedOrganizationId?: string, fallbackOrganizationId?: string): string {
    const organizationId = requestedOrganizationId || fallbackOrganizationId;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required.');
    }

    return organizationId;
  }

  private async assertOrganizationExists(organizationId: string): Promise<void> {
    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null, isActive: true },
      select: { id: true },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }
  }

  private assertOrganizationInScope(organizationId: string, scopeOrganizationIds?: string[]): void {
    if (!scopeOrganizationIds) {
      return;
    }

    if (!scopeOrganizationIds.includes(organizationId)) {
      throw new ForbiddenException('Requested organization is outside the allowed scope.');
    }
  }

  private async getOrganizationMap(client: PrismaExecutor): Promise<Map<string, OrganizationNode>> {
    const organizations = await client.organization.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, parentId: true, teamCode: true },
    });

    return new Map(organizations.map((organization) => [organization.id, organization]));
  }

  private resolveOrganizationPath(
    organizationId: string,
    organizationMap: Map<string, OrganizationNode>,
  ): OrganizationPath {
    const visited = new Set<string>();
    let current = organizationMap.get(organizationId) ?? null;
    let company: OrganizationNode | null = null;
    let group: OrganizationNode | null = null;
    let team: OrganizationNode | null = null;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const classification = resolveOrganizationClassification(current);

      if (classification === 'COMPANY') {
        company = current;
        break;
      }

      if (classification === 'UNIT' && !team) {
        team = current;
      }

      if (classification === 'GROUP' && !group) {
        group = current;
      }

      current = current.parentId ? organizationMap.get(current.parentId) ?? null : null;
    }

    return { company, group, team };
  }

  private uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  }

  private getKstTodayString(): string {
    return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
  }

  private parseDateOnly(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Date must be YYYY-MM-DD.');
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid date.');
    }

    return parsed;
  }

  private parseKstDateStart(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Date must be YYYY-MM-DD.');
    }

    const parsed = new Date(`${value}T00:00:00.000+09:00`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid date.');
    }

    return parsed;
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private formatDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private combineKstDateTime(date: string, time: string): Date {
    return new Date(`${date}T${time}:00.000+09:00`);
  }

  private getDateRange(startDate: Date, endDate: Date): Date[] {
    if (startDate > endDate) {
      throw new BadRequestException('endDate cannot be earlier than startDate.');
    }

    const dates: Date[] = [];
    let cursor = startDate;
    while (cursor <= endDate) {
      dates.push(cursor);
      if (dates.length > MAX_DEPLOYMENT_DAYS) {
        throw new BadRequestException('Deployment range is too long.');
      }
      cursor = this.addDays(cursor, 1);
    }

    return dates;
  }

  private assertTimeRange(startTime: string, endTime: string): void {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
      throw new BadRequestException('Time must be HH:MM.');
    }

    if (startTime >= endTime) {
      throw new BadRequestException('endTime must be later than startTime.');
    }
  }
}
