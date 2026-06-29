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
  SafetyChecklistCandidateFilterDto,
  SafetyChecklistAssignmentDto,
  SafetyChecklistCandidateEmployeeDto,
  SafetyChecklistCandidateGroupDto,
  SafetyChecklistCandidateResponseDto,
  SafetyChecklistCandidateTeamDto,
  SafetyChecklistDeploymentDto,
  SafetyChecklistDateRangeDto,
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
  SafetyInspectionActionStatusFilter,
  SafetyInspectionAnswerDto,
  SafetyInspectionAssignmentDateQueryDto,
  SafetyInspectionAssignmentDatesQueryDto,
  SafetyInspectionAssignmentDatesResponseDto,
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

const SAFETY_ASSIGNMENT_DETAIL_INCLUDE = Prisma.validator<Prisma.SafetyChecklistAssignmentInclude>()({
  checklist: { select: { id: true, title: true } },
  submission: {
    include: {
      answers: {
        orderBy: { sortOrder: 'asc' },
        include: { attachments: true },
      },
    },
  },
});

type SafetyAssignmentDetailRow = Prisma.SafetyChecklistAssignmentGetPayload<{
  include: typeof SAFETY_ASSIGNMENT_DETAIL_INCLUDE;
}>;

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

  async findCandidates(
    filter: SafetyChecklistCandidateFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyChecklistCandidateResponseDto> {
    const organizationMap = await this.getOrganizationMap(this.prisma);
    const accessibleOrganizationIds = this.resolveCompanyExpandedScopeOrganizationIdsFromMap(
      organizationMap,
      scopeOrganizationIds,
    );
    const organizationIds = this.resolveCompanyExpandedScopeOrganizationIdsFromMap(
      organizationMap,
      scopeOrganizationIds,
      filter.companyId,
    );
    const companies = this.buildCandidateCompanyOptions(organizationMap, accessibleOrganizationIds);
    const employees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        status: EmployeeStatus.ACTIVE,
        ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
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
      companies,
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
    const organizationIds = await this.resolveChecklistQueryOrganizationIds(
      scopeOrganizationIds,
      filter.companyId,
      filter.organizationId,
    );
    const where = this.buildChecklistWhere(filter, organizationIds);
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
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const row = await this.prisma.safetyChecklist.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
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
    const latestDeploymentTargetEmployeeIds = row.deployments[0]
      ? await this.findDeploymentTargetEmployeeIds(row.deployments[0].id)
      : [];

    return {
      ...base,
      sections: version ? this.buildSections(version) : [],
      deployments: row.deployments.map((deployment) => this.buildDeploymentDto(deployment)),
      assignments: row.assignments.map((assignment) => this.buildAssignmentDto(assignment)),
      todaySummary: await this.buildTodaySummary(row.id),
      latestDeploymentTargetEmployeeIds,
    };
  }

  async create(
    dto: CreateSafetyChecklistDto,
    scopeOrganizationIds: string[] | undefined,
    fallbackOrganizationId: string | undefined,
    actorId: string | undefined,
  ): Promise<SafetyChecklistDetailDto> {
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const organizationId = this.resolveOwnerOrganizationId(dto.organizationId, fallbackOrganizationId);
    this.assertOrganizationInScope(organizationId, organizationIds);
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
      if (targetEmployeeIds.length > 0 && status === SafetyChecklistStatus.ACTIVE) {
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
          scopeOrganizationIds: organizationIds,
        });
      }

      return { checklistId: checklist.id, versionId: version.id, targetLanguages };
    });

    await this.queueSafetyChecklistVersionTranslations(createdResult.versionId, createdResult.targetLanguages);
    return this.findOne(createdResult.checklistId, organizationIds);
  }

  async update(
    id: string,
    dto: UpdateSafetyChecklistDto,
    scopeOrganizationIds: string[] | undefined,
    actorId: string | undefined,
  ): Promise<SafetyChecklistDetailDto> {
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const existing = await this.prisma.safetyChecklist.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
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

      const shouldDeploy = nextStatus === SafetyChecklistStatus.ACTIVE
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
          scopeOrganizationIds: organizationIds,
        });
      }

      return { versionId, targetLanguages };
    });

    if (updateResult.versionId) {
      await this.queueSafetyChecklistVersionTranslations(updateResult.versionId, updateResult.targetLanguages);
    }

    return this.findOne(id, organizationIds);
  }

  async remove(
    id: string,
    scopeOrganizationIds: string[] | undefined,
    actorId: string | undefined,
  ): Promise<void> {
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const existing = await this.prisma.safetyChecklist.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
      },
      select: {
        id: true,
        versions: { select: { id: true } },
      },
    });

    if (!existing) {
      throw new NotFoundException('Safety checklist not found.');
    }

    await this.prisma.safetyChecklist.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date(),
        status: SafetyChecklistStatus.ARCHIVED,
        updatedById: actorId,
      },
    });

    const versionIds = existing.versions.map((version) => version.id);
    if (versionIds.length > 0) {
      await this.contentTranslationService.deleteEntityTranslationBundles(
        TranslatableEntityType.SAFETY_CHECKLIST,
        versionIds,
      );
    }
  }

  async deploy(
    id: string,
    dto: CreateSafetyChecklistDeploymentDto,
    scopeOrganizationIds: string[] | undefined,
    actorId: string | undefined,
  ): Promise<SafetyChecklistDetailDto> {
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const existing = await this.prisma.safetyChecklist.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
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
        scopeOrganizationIds: organizationIds,
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
    return this.findOne(id, organizationIds);
  }

  async findSubmissions(
    filter: SafetyInspectionSubmissionFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyInspectionSubmissionListResponseDto> {
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds, filter.companyId);
    if (filter.includeUnsubmitted) {
      return this.findAssignmentSubmissionStatuses(filter, organizationIds);
    }

    const page = Math.max(Number(filter.page || DEFAULT_PAGE), 1);
    const limit = Math.min(Math.max(Number(filter.limit || DEFAULT_LIMIT), 1), 100);
    const where = this.buildSubmissionWhere(filter, organizationIds);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.safetyInspectionSubmission.findMany({
        where,
        include: {
          checklist: { select: { id: true, title: true } },
          assignment: {
            select: {
              id: true,
              employeeIdAtAssign: true,
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

  async getSubmissionDateRange(
    filter: SafetyInspectionSubmissionFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyChecklistDateRangeDto> {
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds, filter.companyId);
    const where = this.buildSubmissionWhere({
      ...filter,
      dateFrom: undefined,
      dateTo: undefined,
    }, organizationIds);

    const [first, last] = await this.prisma.$transaction([
      this.prisma.safetyInspectionSubmission.findFirst({
        where,
        select: { submittedAt: true },
        orderBy: { submittedAt: 'asc' },
      }),
      this.prisma.safetyInspectionSubmission.findFirst({
        where,
        select: { submittedAt: true },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    return {
      dateFrom: first ? this.formatKstDateOnly(first.submittedAt) : null,
      dateTo: last ? this.formatKstDateOnly(last.submittedAt) : null,
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
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const row = await this.prisma.safetyInspectionSubmission.findFirst({
      where: {
        id,
        ...(organizationIds ? { checklist: { organizationId: { in: organizationIds } } } : {}),
      },
      include: {
        checklist: { select: { id: true, title: true } },
        assignment: {
          select: {
            id: true,
            employeeIdAtAssign: true,
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

  async findAssignmentDetail(
    id: string,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyInspectionSubmissionDetailDto> {
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const row = await this.prisma.safetyChecklistAssignment.findFirst({
      where: {
        id,
        ...(organizationIds ? { checklist: { organizationId: { in: organizationIds } } } : {}),
      },
      include: SAFETY_ASSIGNMENT_DETAIL_INCLUDE,
    });

    if (!row) {
      throw new NotFoundException('Inspection assignment not found.');
    }

    return this.buildAssignmentDetail(row);
  }

  async findAssignmentDetailByDate(
    query: SafetyInspectionAssignmentDateQueryDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyInspectionSubmissionDetailDto> {
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const row = await this.prisma.safetyChecklistAssignment.findFirst({
      where: {
        checklistId: query.checklistId,
        inspectionDate: this.parseDateOnly(query.inspectionDate),
        OR: [
          { employeeIdAtAssign: query.employeeIdAtAssign },
          { submission: { is: { employeeIdAtSubmit: query.employeeIdAtAssign } } },
        ],
        ...(organizationIds ? { checklist: { organizationId: { in: organizationIds } } } : {}),
      },
      include: SAFETY_ASSIGNMENT_DETAIL_INCLUDE,
    });

    if (!row) {
      throw new NotFoundException('Inspection assignment not found for the selected date.');
    }

    return this.buildAssignmentDetail(row);
  }

  async findAssignmentDates(
    query: SafetyInspectionAssignmentDatesQueryDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyInspectionAssignmentDatesResponseDto> {
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const rows = await this.prisma.safetyChecklistAssignment.findMany({
      where: {
        checklistId: query.checklistId,
        OR: [
          { employeeIdAtAssign: query.employeeIdAtAssign },
          { submission: { is: { employeeIdAtSubmit: query.employeeIdAtAssign } } },
        ],
        ...(organizationIds ? { checklist: { organizationId: { in: organizationIds } } } : {}),
      },
      select: { inspectionDate: true },
      orderBy: { inspectionDate: 'asc' },
    });

    return {
      dates: Array.from(new Set(rows.map((row) => this.formatDateOnly(row.inspectionDate)))),
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
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const checklist = await this.prisma.safetyChecklist.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
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
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const assignment = await this.prisma.safetyChecklistAssignment.findFirst({
      where: {
        id: assignmentId,
        checklistId: id,
        inspectionDate: this.parseDateOnly(this.getKstTodayString()),
        checklist: {
          deletedAt: null,
          ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
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
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds, filter.companyId);

    const assignments = await this.prisma.safetyChecklistAssignment.findMany({
      where: {
        inspectionDate: { gte: from, lt: toExclusive },
        ...(filter.checklistId ? { checklistId: filter.checklistId } : {}),
        ...(organizationIds ? { checklist: { organizationId: { in: organizationIds } } } : {}),
        ...(filter.groupId ? { groupIdAtAssign: filter.groupId } : {}),
        ...(filter.teamId ? { teamIdAtAssign: filter.teamId } : {}),
      },
      select: {
        inspectionDate: true,
        status: true,
        groupIdAtAssign: true,
        groupNameAtAssign: true,
        teamIdAtAssign: true,
        teamNameAtAssign: true,
        submission: { select: { xCount: true, reviewStatus: true } },
      },
    });

    // 출근 여부를 알 수 없어 제출률은 통계로서 의미가 없다.
    // 제출/미제출은 단순 건수(참고 표기)로만, 조치필요 응답·조치는 실제 제출 데이터 기반으로 집계한다.
    const dayBuckets = new Map<string, {
      targetCount: number;
      submittedCount: number;
      xCount: number;
      actionRequiredCount: number;
      actionCompletedCount: number;
    }>();
    for (const dateKey of this.enumerateDateStrings(dateFrom, dateTo)) {
      dayBuckets.set(dateKey, {
        targetCount: 0,
        submittedCount: 0,
        xCount: 0,
        actionRequiredCount: 0,
        actionCompletedCount: 0,
      });
    }

    let submittedCount = 0;
    let xResponseCount = 0;
    let pendingReviewCount = 0;
    let actionRequiredCount = 0;
    let actionCompletedCount = 0;
    const teamBuckets = new Map<string, {
      groupId: string | null;
      groupName: string | null;
      teamId: string | null;
      teamName: string | null;
      targetCount: number;
      submittedCount: number;
      xCount: number;
      actionRequiredCount: number;
      actionCompletedCount: number;
    }>();

    for (const assignment of assignments) {
      const dateKey = this.formatDateOnly(assignment.inspectionDate);
      const dayBucket = dayBuckets.get(dateKey) ?? {
        targetCount: 0,
        submittedCount: 0,
        xCount: 0,
        actionRequiredCount: 0,
        actionCompletedCount: 0,
      };
      dayBucket.targetCount += 1;

      const teamKey = assignment.teamIdAtAssign
        || assignment.groupIdAtAssign
        || assignment.teamNameAtAssign
        || assignment.groupNameAtAssign
        || 'unassigned';
      const teamBucket = teamBuckets.get(teamKey) ?? {
        groupId: assignment.groupIdAtAssign ?? null,
        groupName: assignment.groupNameAtAssign ?? null,
        teamId: assignment.teamIdAtAssign ?? null,
        teamName: assignment.teamNameAtAssign ?? assignment.groupNameAtAssign ?? '미분류',
        targetCount: 0,
        submittedCount: 0,
        xCount: 0,
        actionRequiredCount: 0,
        actionCompletedCount: 0,
      };
      teamBucket.targetCount += 1;

      const isSubmitted = assignment.status === SafetyChecklistAssignmentStatus.SUBMITTED || Boolean(assignment.submission);
      if (isSubmitted) {
        submittedCount += 1;
        dayBucket.submittedCount += 1;
        teamBucket.submittedCount += 1;
      }

      if (assignment.submission) {
        const { xCount, reviewStatus } = assignment.submission;
        xResponseCount += xCount;
        dayBucket.xCount += xCount;
        teamBucket.xCount += xCount;
        if (xCount > 0 && reviewStatus === SafetyInspectionReviewStatus.PENDING) pendingReviewCount += 1;
        if (
          xCount > 0
          && (
            reviewStatus === SafetyInspectionReviewStatus.PENDING
            || reviewStatus === SafetyInspectionReviewStatus.ACTION_REQUIRED
          )
        ) {
          actionRequiredCount += 1;
          dayBucket.actionRequiredCount += 1;
          teamBucket.actionRequiredCount += 1;
        }
        if (xCount > 0 && reviewStatus === SafetyInspectionReviewStatus.ACTION_COMPLETED) {
          actionCompletedCount += 1;
          dayBucket.actionCompletedCount += 1;
          teamBucket.actionCompletedCount += 1;
        }
      }

      dayBuckets.set(dateKey, dayBucket);
      teamBuckets.set(teamKey, teamBucket);
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
        targetCount: bucket.targetCount,
        submittedCount: bucket.submittedCount,
        submitted: bucket.submittedCount,
        submissionRate: this.toRate(bucket.submittedCount, bucket.targetCount),
        xCount: bucket.xCount,
        actionRequiredCount: bucket.actionRequiredCount,
        actionCompletedCount: bucket.actionCompletedCount,
        actionCompletionRate: this.toRate(
          bucket.actionCompletedCount,
          bucket.actionRequiredCount + bucket.actionCompletedCount,
        ),
      })),
      teamComparisons: Array.from(teamBuckets.values())
        .map((bucket) => ({
          groupId: bucket.groupId,
          groupName: bucket.groupName,
          teamId: bucket.teamId,
          teamName: bucket.teamName,
          targetCount: bucket.targetCount,
          submittedCount: bucket.submittedCount,
          submissionRate: this.toRate(bucket.submittedCount, bucket.targetCount),
          xCount: bucket.xCount,
          actionRequiredCount: bucket.actionRequiredCount,
          actionCompletedCount: bucket.actionCompletedCount,
          actionCompletionRate: this.toRate(
            bucket.actionCompletedCount,
            bucket.actionRequiredCount + bucket.actionCompletedCount,
          ),
        }))
        .sort((left, right) => right.targetCount - left.targetCount || right.submissionRate - left.submissionRate)
        .slice(0, 20),
    };
  }

  async getPatterns(
    filter: SafetyChecklistPatternsFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyChecklistPatternsDto> {
    const { dateFrom, dateTo } = this.resolveStatsRange(filter.dateFrom, filter.dateTo, 30);
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds, filter.companyId);
    const scopeFilter = organizationIds ? { checklist: { organizationId: { in: organizationIds } } } : {};
    const assignmentSnapshotFilter = {
      ...(filter.groupId ? { groupIdAtAssign: filter.groupId } : {}),
      ...(filter.teamId ? { teamIdAtAssign: filter.teamId } : {}),
    };

    // 출근 여부를 알 수 없어 미제출은 통계로서 의미가 없으므로 반복 미제출 집계는 제공하지 않는다.
    // 실제 제출된 답변 기반의 반복 조치필요 응답 항목만 집계한다.
    // submittedAt은 timestamptz이므로 KST 경계를 사용한다.
    const submittedFrom = this.parseKstDateStart(dateFrom);
    const submittedToExclusive = this.addDays(this.parseKstDateStart(dateTo), 1);
    const assignmentFrom = this.parseDateOnly(dateFrom);
    const assignmentToExclusive = this.addDays(this.parseDateOnly(dateTo), 1);
    const assignments = await this.prisma.safetyChecklistAssignment.findMany({
      where: {
        inspectionDate: { gte: assignmentFrom, lt: assignmentToExclusive },
        ...(filter.checklistId ? { checklistId: filter.checklistId } : {}),
        ...(organizationIds ? { checklist: { organizationId: { in: organizationIds } } } : {}),
        ...assignmentSnapshotFilter,
      },
      select: {
        employeeIdAtAssign: true,
        employeeNameAtAssign: true,
        groupNameAtAssign: true,
        teamNameAtAssign: true,
        status: true,
        submittedAt: true,
        submission: { select: { id: true, submittedAt: true } },
      },
    });
    const answers = await this.prisma.safetyInspectionAnswer.findMany({
      where: {
        submission: {
          submittedAt: { gte: submittedFrom, lt: submittedToExclusive },
          ...(filter.checklistId ? { checklistId: filter.checklistId } : {}),
          ...scopeFilter,
          ...(Object.keys(assignmentSnapshotFilter).length > 0 ? { assignment: assignmentSnapshotFilter } : {}),
        },
      },
      select: {
        itemId: true,
        question: true,
        sectionTitle: true,
        category: true,
        answer: true,
        submission: {
          select: {
            checklistId: true,
            submittedAt: true,
            reviewStatus: true,
            employeeIdAtSubmit: true,
            employeeNameAtSubmit: true,
            checklist: { select: { title: true } },
          },
        },
      },
    });

    const itemBuckets = new Map<string, {
      itemId: string | null;
      checklistId: string;
      checklistTitle: string;
      question: string;
      section: string | null;
      category: string | null;
      x: number;
      total: number;
      affectedEmployeeIds: Set<string>;
      actionRequiredCount: number;
      actionCompletedCount: number;
      latestOccurredAt: Date | null;
      recentEmployeeName: string | null;
    }>();
    for (const answer of answers) {
      const key = [
        answer.submission.checklistId,
        answer.itemId ?? answer.sectionTitle ?? '',
        answer.question,
      ].join('::');
      const bucket = itemBuckets.get(key) ?? {
        itemId: answer.itemId ?? null,
        checklistId: answer.submission.checklistId,
        checklistTitle: answer.submission.checklist.title,
        question: answer.question,
        section: answer.sectionTitle,
        category: answer.category,
        x: 0,
        total: 0,
        affectedEmployeeIds: new Set<string>(),
        actionRequiredCount: 0,
        actionCompletedCount: 0,
        latestOccurredAt: null,
        recentEmployeeName: null,
      };
      bucket.total += 1;
      if (answer.answer === false) {
        bucket.x += 1;
        bucket.affectedEmployeeIds.add(answer.submission.employeeIdAtSubmit);
        if (answer.submission.reviewStatus === SafetyInspectionReviewStatus.ACTION_COMPLETED) {
          bucket.actionCompletedCount += 1;
        } else {
          bucket.actionRequiredCount += 1;
        }
        if (!bucket.latestOccurredAt || answer.submission.submittedAt > bucket.latestOccurredAt) {
          bucket.latestOccurredAt = answer.submission.submittedAt;
          bucket.recentEmployeeName = resolveEmployeeDisplayName(
            answer.submission.employeeNameAtSubmit,
            answer.submission.employeeIdAtSubmit,
          );
        }
      }
      itemBuckets.set(key, bucket);
    }

    const repeatXItems = Array.from(itemBuckets.values())
      .filter((bucket) => bucket.x > 0)
      .map((bucket) => ({
        itemId: bucket.itemId,
        checklistId: bucket.checklistId,
        checklistTitle: bucket.checklistTitle,
        question: bucket.question,
        section: bucket.section,
        category: bucket.category,
        xCount: bucket.x,
        totalCount: bucket.total,
        xRate: this.toRate(bucket.x, bucket.total),
        affectedEmployeeCount: bucket.affectedEmployeeIds.size,
        actionRequiredCount: bucket.actionRequiredCount,
        actionCompletedCount: bucket.actionCompletedCount,
        latestOccurredAt: bucket.latestOccurredAt,
        recentEmployeeName: bucket.recentEmployeeName,
      }))
      .sort((a, b) => b.xCount - a.xCount || b.xRate - a.xRate || b.affectedEmployeeCount - a.affectedEmployeeCount)
      .slice(0, 10);

    const employeeBuckets = new Map<string, {
      employeeIdAtAssign: string;
      employeeName: string;
      groupName: string | null;
      teamName: string | null;
      totalAssignments: number;
      submittedCount: number;
      lastSubmittedAt: Date | null;
    }>();

    for (const assignment of assignments) {
      const bucket = employeeBuckets.get(assignment.employeeIdAtAssign) ?? {
        employeeIdAtAssign: assignment.employeeIdAtAssign,
        employeeName: assignment.employeeNameAtAssign,
        groupName: assignment.groupNameAtAssign ?? null,
        teamName: assignment.teamNameAtAssign ?? null,
        totalAssignments: 0,
        submittedCount: 0,
        lastSubmittedAt: null,
      };
      bucket.totalAssignments += 1;

      const submittedAt = assignment.submission?.submittedAt ?? assignment.submittedAt ?? null;
      const isSubmitted = assignment.status === SafetyChecklistAssignmentStatus.SUBMITTED || Boolean(assignment.submission);
      if (isSubmitted) {
        bucket.submittedCount += 1;
        if (submittedAt && (!bucket.lastSubmittedAt || submittedAt > bucket.lastSubmittedAt)) {
          bucket.lastSubmittedAt = submittedAt;
        }
      }

      employeeBuckets.set(assignment.employeeIdAtAssign, bucket);
    }

    const repeatNonSubmitters = Array.from(employeeBuckets.values())
      .map((bucket) => ({
        employeeIdAtAssign: bucket.employeeIdAtAssign,
        employeeName: bucket.employeeName,
        groupName: bucket.groupName,
        teamName: bucket.teamName,
        missedCount: bucket.totalAssignments - bucket.submittedCount,
        totalAssignments: bucket.totalAssignments,
        submittedCount: bucket.submittedCount,
        submissionRate: this.toRate(bucket.submittedCount, bucket.totalAssignments),
        lastSubmittedAt: bucket.lastSubmittedAt,
      }))
      .filter((bucket) => bucket.missedCount > 0)
      .sort((left, right) => right.missedCount - left.missedCount || left.submissionRate - right.submissionRate)
      .slice(0, 10);

    return { dateFrom, dateTo, repeatNonSubmitters, repeatXItems };
  }

  async getDateRange(
    filter: SafetyChecklistStatisticsFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<SafetyChecklistDateRangeDto> {
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds, filter.companyId);
    const where: Prisma.SafetyChecklistAssignmentWhereInput = {
      ...(organizationIds ? { checklist: { organizationId: { in: organizationIds } } } : {}),
      ...(filter.checklistId ? { checklistId: filter.checklistId } : {}),
      ...this.buildAssignmentSnapshotFilter(filter),
    };

    const [first, last] = await this.prisma.$transaction([
      this.prisma.safetyChecklistAssignment.findFirst({
        where,
        select: { inspectionDate: true },
        orderBy: { inspectionDate: 'asc' },
      }),
      this.prisma.safetyChecklistAssignment.findFirst({
        where,
        select: { inspectionDate: true },
        orderBy: { inspectionDate: 'desc' },
      }),
    ]);

    return {
      dateFrom: first ? this.formatDateOnly(first.inspectionDate) : null,
      dateTo: last ? this.formatDateOnly(last.inspectionDate) : null,
    };
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

  private async resolveCompanyExpandedScopeOrganizationIds(
    scopeOrganizationIds?: string[],
    companyId?: string,
  ): Promise<string[] | undefined> {
    const organizationMap = await this.getOrganizationMap(this.prisma);
    return this.resolveCompanyExpandedScopeOrganizationIdsFromMap(
      organizationMap,
      scopeOrganizationIds,
      companyId,
    );
  }

  private async resolveChecklistQueryOrganizationIds(
    scopeOrganizationIds: string[] | undefined,
    companyId?: string,
    organizationId?: string,
  ): Promise<string[] | undefined> {
    const organizationMap = await this.getOrganizationMap(this.prisma);
    const organizationIds = this.resolveCompanyExpandedScopeOrganizationIdsFromMap(
      organizationMap,
      scopeOrganizationIds,
      companyId,
    );

    if (!organizationId) {
      return organizationIds;
    }

    if (!organizationMap.has(organizationId)) {
      throw new NotFoundException('Organization not found.');
    }

    if (organizationIds && !organizationIds.includes(organizationId)) {
      throw new ForbiddenException('Requested organization is outside the allowed company scope.');
    }

    return [organizationId];
  }

  private resolveCompanyExpandedScopeOrganizationIdsFromMap(
    organizationMap: Map<string, OrganizationNode>,
    scopeOrganizationIds?: string[],
    companyId?: string,
  ): string[] | undefined {
    let allowedOrganizationIds: Set<string> | undefined;

    if (scopeOrganizationIds) {
      const companyIds = new Set<string>();
      for (const organizationId of scopeOrganizationIds) {
        const resolvedCompanyId = this.resolveCompanyIdFromMap(organizationId, organizationMap);
        if (resolvedCompanyId) {
          companyIds.add(resolvedCompanyId);
        }
      }

      allowedOrganizationIds = new Set<string>();
      for (const resolvedCompanyId of companyIds) {
        for (const descendantId of this.collectDescendantOrganizationIds(resolvedCompanyId, organizationMap)) {
          allowedOrganizationIds.add(descendantId);
        }
      }

      if (allowedOrganizationIds.size === 0) {
        allowedOrganizationIds = new Set(scopeOrganizationIds);
      }
    }

    if (!companyId) {
      return allowedOrganizationIds ? Array.from(allowedOrganizationIds).sort() : undefined;
    }

    const company = organizationMap.get(companyId);
    if (!company) {
      throw new NotFoundException('Company organization not found.');
    }
    if (resolveOrganizationClassification(company) !== 'COMPANY') {
      throw new BadRequestException('companyId must be a company organization.');
    }

    const selectedOrganizationIds = this.collectDescendantOrganizationIds(companyId, organizationMap);
    if (!allowedOrganizationIds) {
      return selectedOrganizationIds.sort();
    }

    const selectedSet = new Set(selectedOrganizationIds);
    const intersection = Array.from(allowedOrganizationIds)
      .filter((organizationId) => selectedSet.has(organizationId))
      .sort();

    if (intersection.length === 0) {
      throw new ForbiddenException('Requested company is outside the allowed scope.');
    }

    return intersection;
  }

  private buildCandidateCompanyOptions(
    organizationMap: Map<string, OrganizationNode>,
    accessibleOrganizationIds?: string[],
  ): Array<{ id: string; name: string }> {
    const accessibleSet = accessibleOrganizationIds ? new Set(accessibleOrganizationIds) : null;
    return Array.from(organizationMap.values())
      .filter((organization) => resolveOrganizationClassification(organization) === 'COMPANY')
      .filter((organization) => !accessibleSet || accessibleSet.has(organization.id))
      .map((organization) => ({ id: organization.id, name: organization.name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private resolveCompanyIdFromMap(
    organizationId: string,
    organizationMap: Map<string, OrganizationNode>,
  ): string | null {
    const visited = new Set<string>();
    let current = organizationMap.get(organizationId) ?? null;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (resolveOrganizationClassification(current) === 'COMPANY') {
        return current.id;
      }
      current = current.parentId ? organizationMap.get(current.parentId) ?? null : null;
    }

    return null;
  }

  private collectDescendantOrganizationIds(
    organizationId: string,
    organizationMap: Map<string, OrganizationNode>,
  ): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    let frontier = [organizationId];

    while (frontier.length > 0) {
      const currentId = frontier.shift()!;
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);
      if (organizationMap.has(currentId)) {
        result.push(currentId);
      }

      for (const organization of organizationMap.values()) {
        if (organization.parentId === currentId && !visited.has(organization.id)) {
          frontier.push(organization.id);
        }
      }
    }

    return result;
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
    filter: Partial<SafetyInspectionSubmissionFilterDto>,
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

    if (filter.actionStatus) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        filter.actionStatus === SafetyInspectionActionStatusFilter.NOT_SUBMITTED
          ? { id: '__not_submitted__' }
          : this.buildActionStatusSubmissionWhere(filter.actionStatus),
      ];
    }

    const assignmentWhere = this.buildAssignmentSnapshotFilter(filter);
    if (Object.keys(assignmentWhere).length > 0) {
      where.assignment = assignmentWhere;
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
      ...this.buildAssignmentSnapshotFilter(filter),
    };
    const and: Prisma.SafetyChecklistAssignmentWhereInput[] = [];

    if (filter.checklistId) {
      where.checklistId = filter.checklistId;
    }

    if (filter.reviewStatus) {
      and.push({ submission: { is: this.buildReviewStatusWhere(filter.reviewStatus) } });
    }

    if (filter.actionStatus) {
      if (filter.actionStatus === SafetyInspectionActionStatusFilter.NOT_SUBMITTED) {
        and.push({ submission: { is: null } });
      } else {
        and.push({ submission: { is: this.buildActionStatusSubmissionWhere(filter.actionStatus) } });
      }
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

  private buildAssignmentSnapshotFilter(filter: {
    groupId?: string;
    teamId?: string;
  }): Prisma.SafetyChecklistAssignmentWhereInput {
    return {
      ...(filter.groupId ? { groupIdAtAssign: filter.groupId } : {}),
      ...(filter.teamId ? { teamIdAtAssign: filter.teamId } : {}),
    };
  }

  private buildActionStatusSubmissionWhere(
    actionStatus: SafetyInspectionActionStatusFilter,
  ): Prisma.SafetyInspectionSubmissionWhereInput {
    if (actionStatus === SafetyInspectionActionStatusFilter.NORMAL) {
      return { xCount: { lte: 0 } };
    }

    if (actionStatus === SafetyInspectionActionStatusFilter.ACTION_REQUIRED) {
      return {
        xCount: { gt: 0 },
        reviewStatus: { not: SafetyInspectionReviewStatus.ACTION_COMPLETED },
      };
    }

    if (actionStatus === SafetyInspectionActionStatusFilter.ACTION_COMPLETED) {
      return {
        xCount: { gt: 0 },
        reviewStatus: SafetyInspectionReviewStatus.ACTION_COMPLETED,
      };
    }

    return { id: '__not_submitted__' };
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

  private async findDeploymentTargetEmployeeIds(deploymentId: string): Promise<string[]> {
    const rows = await this.prisma.safetyChecklistAssignment.findMany({
      where: { deploymentId },
      select: { employeeIdAtAssign: true },
      distinct: ['employeeIdAtAssign'],
      orderBy: { employeeIdAtAssign: 'asc' },
    });

    return rows.map((row) => row.employeeIdAtAssign);
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
        groupIdAtAssign: true,
        groupNameAtAssign: true,
        teamIdAtAssign: true,
        teamNameAtAssign: true,
        inspectionDate: true,
        status: true,
        submittedAt: true,
        submission: {
          select: {
            id: true,
            oCount: true,
            xCount: true,
            reviewStatus: true,
            submittedAt: true,
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
          submissionId: assignment.submission?.id ?? null,
          employeeId: assignment.employeeId ?? assignment.employeeIdAtAssign,
          employeeName: resolveEmployeeDisplayName(assignment.employeeNameAtAssign, assignment.employeeIdAtAssign),
          organizationName: assignment.organizationNameAtAssign ?? null,
          groupId: assignment.groupIdAtAssign ?? null,
          groupName: assignment.groupNameAtAssign ?? null,
          teamId: assignment.teamIdAtAssign ?? null,
          teamName: assignment.teamNameAtAssign ?? null,
          inspectionDate: assignment.inspectionDate,
          status: assignment.status,
          submitted: assignment.status === SafetyChecklistAssignmentStatus.SUBMITTED || Boolean(assignment.submission),
          submittedAt: assignment.submission?.submittedAt ?? assignment.submittedAt ?? null,
          reviewStatus: assignment.submission?.reviewStatus ?? null,
          oCount: assignment.submission?.oCount ?? 0,
          xCount: assignment.submission?.xCount ?? 0,
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
      employeeIdAtAssign: string;
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
      employeeIdAtAssign: row.assignment?.employeeIdAtAssign ?? row.employeeIdAtSubmit,
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
      employeeIdAtAssign: row.employeeIdAtAssign,
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

  private buildAssignmentDetail(row: SafetyAssignmentDetailRow): SafetyInspectionSubmissionDetailDto {
    const submission = row.submission ?? null;
    const employeeIdAtSubmit = submission?.employeeIdAtSubmit ?? row.employeeIdAtAssign;
    const employeeNameAtSubmit = submission?.employeeNameAtSubmit ?? row.employeeNameAtAssign;

    return {
      id: submission?.id ?? row.id,
      assignmentId: row.id,
      checklistId: row.checklistId,
      checklistTitle: row.checklist.title,
      employeeId: submission?.employeeId ?? row.employeeId ?? null,
      employeeIdAtAssign: row.employeeIdAtAssign,
      employeeIdAtSubmit,
      employeeNameAtSubmit: resolveEmployeeDisplayName(employeeNameAtSubmit, employeeIdAtSubmit),
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
      startedAt: row.startedAt ?? null,
      dueAt: row.dueAt ?? null,
      reviewComment: submission?.reviewComment ?? null,
      reviewedAt: submission?.reviewedAt ?? null,
      reviewedById: submission?.reviewedById ?? null,
      answers: submission?.answers.map((answer) => this.buildAnswerDto(answer)) ?? [],
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
    const organizationIds = await this.resolveCompanyExpandedScopeOrganizationIds(scopeOrganizationIds);
    const attachment = await this.prisma.safetyInspectionAttachment.findFirst({
      where: {
        id: attachmentId,
        answerId,
        ...(organizationIds
          ? { answer: { submission: { checklist: { organizationId: { in: organizationIds } } } } }
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
    const dates = this.buildDateRange(startDate, endDate);
    const startTime = input.startTime ?? '09:00';
    const endTime = input.endTime ?? '17:00';
    this.assertTimeRange(startTime, endTime);
    const organizationMap = await this.getOrganizationMap(tx);
    const employees = await this.findAssignableEmployees(tx, input.targetEmployeeIds, input.scopeOrganizationIds);

    if (employees.length === 0) {
      throw new BadRequestException('적용 가능한 활성 직원이 없습니다.');
    }

    await this.removeOverlappingOpenAssignments(tx, {
      checklistId: input.checklistId,
      employeeIds: employees.map((employee) => employee.id),
      inspectionDates: dates,
    });

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

  private async removeOverlappingOpenAssignments(
    tx: Prisma.TransactionClient,
    input: {
      checklistId: string;
      employeeIds: string[];
      inspectionDates: Date[];
    },
  ): Promise<void> {
    if (input.employeeIds.length === 0 || input.inspectionDates.length === 0) {
      return;
    }

    const assignments = await tx.safetyChecklistAssignment.findMany({
      where: {
        checklistId: input.checklistId,
        employeeIdAtAssign: { in: input.employeeIds },
        inspectionDate: { in: input.inspectionDates },
        status: { not: SafetyChecklistAssignmentStatus.SUBMITTED },
        submission: { is: null },
      },
      select: {
        id: true,
        deploymentId: true,
      },
    });

    if (assignments.length === 0) {
      return;
    }

    const assignmentIds = assignments.map((assignment) => assignment.id);
    const affectedDeploymentIds = Array.from(new Set(assignments.map((assignment) => assignment.deploymentId)));

    await tx.safetyChecklistPushNotification.deleteMany({
      where: { assignmentId: { in: assignmentIds } },
    });

    await tx.safetyChecklistAssignment.deleteMany({
      where: { id: { in: assignmentIds } },
    });

    const emptyDeployments = await tx.safetyChecklistDeployment.findMany({
      where: {
        id: { in: affectedDeploymentIds },
        assignments: { none: {} },
      },
      select: { id: true },
    });

    if (emptyDeployments.length > 0) {
      await tx.safetyChecklistDeployment.updateMany({
        where: { id: { in: emptyDeployments.map((deployment) => deployment.id) } },
        data: { status: SafetyChecklistDeploymentStatus.ENDED },
      });
    }
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

  private formatKstDateOnly(date: Date): string {
    return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
  }

  private combineKstDateTime(date: string, time: string): Date {
    return new Date(`${date}T${time}:00.000+09:00`);
  }

  private buildDateRange(startDate: Date, endDate: Date): Date[] {
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
