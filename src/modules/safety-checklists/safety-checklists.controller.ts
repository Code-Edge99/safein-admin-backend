import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';
import { PermissionCodes } from '../auth/decorators/permission-codes.decorator';
import { EffectivePermissionsGuard } from '../auth/guards/effective-permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import {
  CreateSafetyChecklistDeploymentDto,
  CreateSafetyChecklistDto,
  ReviewSafetyInspectionSubmissionDto,
  SafetyChecklistPushMessageResultDto,
  SafetyChecklistCandidateResponseDto,
  SafetyChecklistDetailDto,
  SafetyChecklistFilterDto,
  SafetyChecklistListResponseDto,
  SafetyChecklistPatternsDto,
  SafetyChecklistPatternsFilterDto,
  SafetyChecklistStatisticsDto,
  SafetyChecklistStatisticsFilterDto,
  SafetyInspectionSubmissionDetailDto,
  SafetyInspectionSubmissionFilterDto,
  SafetyInspectionSubmissionListResponseDto,
  SendSafetyChecklistPushMessageDto,
  UpdateSafetyChecklistDto,
} from './dto';
import { SafetyChecklistsService } from './safety-checklists.service';

@ApiTags('Safety checklists')
@Controller('safety-checklists')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard, EffectivePermissionsGuard)
@PermissionCodes('SAFETY_CHECKLIST_READ')
@ApiBearerAuth()
export class SafetyChecklistsController {
  constructor(private readonly safetyChecklistsService: SafetyChecklistsService) {}

  @Get('candidates')
  @ApiOperation({ summary: 'Get employees available for checklist assignment' })
  @ApiResponse({ status: 200, type: SafetyChecklistCandidateResponseDto })
  findCandidates(@Req() req: AuthenticatedAdminRequest): Promise<SafetyChecklistCandidateResponseDto> {
    return this.safetyChecklistsService.findCandidates(req.organizationScopeIds ?? undefined);
  }

  @Get('submissions')
  @ApiOperation({ summary: 'Get safety inspection submission history' })
  @ApiResponse({ status: 200, type: SafetyInspectionSubmissionListResponseDto })
  findSubmissions(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: SafetyInspectionSubmissionFilterDto,
  ): Promise<SafetyInspectionSubmissionListResponseDto> {
    return this.safetyChecklistsService.findSubmissions(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('submissions/:id')
  @ApiOperation({ summary: 'Get safety inspection submission detail' })
  @ApiResponse({ status: 200, type: SafetyInspectionSubmissionDetailDto })
  findSubmissionDetail(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<SafetyInspectionSubmissionDetailDto> {
    return this.safetyChecklistsService.findSubmissionDetail(id, req.organizationScopeIds ?? undefined);
  }

  @Patch('submissions/:id/review')
  @PermissionCodes('SAFETY_CHECKLIST_WRITE')
  @ApiOperation({ summary: 'Update safety inspection review status' })
  @ApiResponse({ status: 200, type: SafetyInspectionSubmissionDetailDto })
  reviewSubmission(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: ReviewSafetyInspectionSubmissionDto,
  ): Promise<SafetyInspectionSubmissionDetailDto> {
    return this.safetyChecklistsService.reviewSubmission(
      id,
      dto,
      req.organizationScopeIds ?? undefined,
      req.user?.id,
    );
  }

  @Get('answers/:answerId/attachments/:attachmentId/download')
  @ApiOperation({ summary: 'Download safety inspection answer attachment' })
  async downloadAnswerAttachment(
    @Req() req: AuthenticatedAdminRequest,
    @Param('answerId') answerId: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const target = await this.safetyChecklistsService.resolveAttachmentFileTarget(
      answerId,
      attachmentId,
      req.organizationScopeIds ?? undefined,
    );

    res.setHeader('Content-Type', target.mimeType);
    res.setHeader('Content-Disposition', this.safetyChecklistsService.buildContentDisposition(target.originalName, target.isImage));
    res.sendFile(target.absolutePath);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Get safety inspection statistics and trends' })
  @ApiResponse({ status: 200, type: SafetyChecklistStatisticsDto })
  getStatistics(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: SafetyChecklistStatisticsFilterDto,
  ): Promise<SafetyChecklistStatisticsDto> {
    return this.safetyChecklistsService.getStatistics(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('patterns')
  @ApiOperation({ summary: 'Get safety inspection repeat patterns' })
  @ApiResponse({ status: 200, type: SafetyChecklistPatternsDto })
  getPatterns(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: SafetyChecklistPatternsFilterDto,
  ): Promise<SafetyChecklistPatternsDto> {
    return this.safetyChecklistsService.getPatterns(filter, req.organizationScopeIds ?? undefined);
  }

  @Get()
  @ApiOperation({ summary: 'Get safety checklists' })
  @ApiResponse({ status: 200, type: SafetyChecklistListResponseDto })
  findAll(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: SafetyChecklistFilterDto,
  ): Promise<SafetyChecklistListResponseDto> {
    return this.safetyChecklistsService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Post()
  @PermissionCodes('SAFETY_CHECKLIST_WRITE')
  @ApiOperation({ summary: 'Create a safety checklist' })
  @ApiResponse({ status: 201, type: SafetyChecklistDetailDto })
  create(
    @Req() req: AuthenticatedAdminRequest,
    @Body() dto: CreateSafetyChecklistDto,
  ): Promise<SafetyChecklistDetailDto> {
    return this.safetyChecklistsService.create(
      dto,
      req.organizationScopeIds ?? undefined,
      req.user?.organizationId,
      req.user?.id,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get safety checklist detail' })
  @ApiResponse({ status: 200, type: SafetyChecklistDetailDto })
  findOne(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<SafetyChecklistDetailDto> {
    return this.safetyChecklistsService.findOne(id, req.organizationScopeIds ?? undefined);
  }

  @Post(':id/today-non-submitters/push-message')
  @PermissionCodes('SAFETY_CHECKLIST_WRITE')
  @ApiOperation({ summary: '오늘 미제출 작업자 전체에게 푸시 메시지 발송' })
  @ApiResponse({ status: 201, type: SafetyChecklistPushMessageResultDto })
  sendTodayNonSubmitterPushMessage(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: SendSafetyChecklistPushMessageDto,
  ): Promise<SafetyChecklistPushMessageResultDto> {
    return this.safetyChecklistsService.sendTodayNonSubmitterPushMessage(
      id,
      dto,
      req.organizationScopeIds ?? undefined,
      req.user?.id,
    );
  }

  @Post(':id/assignments/:assignmentId/push-message')
  @PermissionCodes('SAFETY_CHECKLIST_WRITE')
  @ApiOperation({ summary: '오늘 미제출 작업자에게 개별 푸시 메시지 발송' })
  @ApiResponse({ status: 201, type: SafetyChecklistPushMessageResultDto })
  sendAssignmentPushMessage(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: SendSafetyChecklistPushMessageDto,
  ): Promise<SafetyChecklistPushMessageResultDto> {
    return this.safetyChecklistsService.sendAssignmentPushMessage(
      id,
      assignmentId,
      dto,
      req.organizationScopeIds ?? undefined,
      req.user?.id,
    );
  }

  @Patch(':id')
  @PermissionCodes('SAFETY_CHECKLIST_WRITE')
  @ApiOperation({ summary: 'Update a safety checklist' })
  @ApiResponse({ status: 200, type: SafetyChecklistDetailDto })
  update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateSafetyChecklistDto,
  ): Promise<SafetyChecklistDetailDto> {
    return this.safetyChecklistsService.update(id, dto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Post(':id/deploy')
  @PermissionCodes('SAFETY_CHECKLIST_WRITE')
  @ApiOperation({ summary: 'Apply a safety checklist to employees' })
  @ApiResponse({ status: 201, type: SafetyChecklistDetailDto })
  deploy(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: CreateSafetyChecklistDeploymentDto,
  ): Promise<SafetyChecklistDetailDto> {
    return this.safetyChecklistsService.deploy(id, dto, req.organizationScopeIds ?? undefined, req.user?.id);
  }
}
