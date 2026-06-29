import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
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
  SafetyInspectionAssignmentDateQueryDto,
  SafetyInspectionAssignmentDatesQueryDto,
  SafetyInspectionAssignmentDatesResponseDto,
  SafetyChecklistCandidateFilterDto,
  SafetyChecklistPushMessageResultDto,
  SafetyChecklistCandidateResponseDto,
  SafetyChecklistDateRangeDto,
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

@ApiTags('안전점검 체크리스트')
@Controller('safety-checklists')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard, EffectivePermissionsGuard)
@PermissionCodes('SAFETY_CHECKLIST_READ')
@ApiBearerAuth()
export class SafetyChecklistsController {
  constructor(private readonly safetyChecklistsService: SafetyChecklistsService) {}

  @Get('candidates')
  @ApiOperation({ summary: '안전점검 배정 가능 직원 후보 조회' })
  @ApiResponse({ status: 200, type: SafetyChecklistCandidateResponseDto })
  findCandidates(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: SafetyChecklistCandidateFilterDto,
  ): Promise<SafetyChecklistCandidateResponseDto> {
    return this.safetyChecklistsService.findCandidates(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('submissions')
  @ApiOperation({ summary: '안전점검 제출 현황 조회' })
  @ApiResponse({ status: 200, type: SafetyInspectionSubmissionListResponseDto })
  findSubmissions(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: SafetyInspectionSubmissionFilterDto,
  ): Promise<SafetyInspectionSubmissionListResponseDto> {
    return this.safetyChecklistsService.findSubmissions(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('submissions/date-range')
  @ApiOperation({ summary: '안전점검 제출 데이터 날짜 범위 조회' })
  @ApiResponse({ status: 200, type: SafetyChecklistDateRangeDto })
  getSubmissionDateRange(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: SafetyInspectionSubmissionFilterDto,
  ): Promise<SafetyChecklistDateRangeDto> {
    return this.safetyChecklistsService.getSubmissionDateRange(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('submissions/:id')
  @ApiOperation({ summary: '안전점검 제출 상세 조회' })
  @ApiResponse({ status: 200, type: SafetyInspectionSubmissionDetailDto })
  findSubmissionDetail(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<SafetyInspectionSubmissionDetailDto> {
    return this.safetyChecklistsService.findSubmissionDetail(id, req.organizationScopeIds ?? undefined);
  }

  @Get('assignments/by-date')
  @ApiOperation({ summary: '안전점검 작업자/날짜별 제출 상세 조회' })
  @ApiResponse({ status: 200, type: SafetyInspectionSubmissionDetailDto })
  findAssignmentDetailByDate(
    @Req() req: AuthenticatedAdminRequest,
    @Query() query: SafetyInspectionAssignmentDateQueryDto,
  ): Promise<SafetyInspectionSubmissionDetailDto> {
    return this.safetyChecklistsService.findAssignmentDetailByDate(query, req.organizationScopeIds ?? undefined);
  }

  @Get('assignments/dates')
  @ApiOperation({ summary: '안전점검 작업자별 배정 날짜 목록 조회' })
  @ApiResponse({ status: 200, type: SafetyInspectionAssignmentDatesResponseDto })
  findAssignmentDates(
    @Req() req: AuthenticatedAdminRequest,
    @Query() query: SafetyInspectionAssignmentDatesQueryDto,
  ): Promise<SafetyInspectionAssignmentDatesResponseDto> {
    return this.safetyChecklistsService.findAssignmentDates(query, req.organizationScopeIds ?? undefined);
  }

  @Get('assignments/:id/detail')
  @ApiOperation({ summary: '안전점검 배정 상세 조회' })
  @ApiResponse({ status: 200, type: SafetyInspectionSubmissionDetailDto })
  findAssignmentDetail(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<SafetyInspectionSubmissionDetailDto> {
    return this.safetyChecklistsService.findAssignmentDetail(id, req.organizationScopeIds ?? undefined);
  }

  @Patch('submissions/:id/review')
  @PermissionCodes('SAFETY_CHECKLIST_WRITE')
  @ApiOperation({ summary: '안전점검 관리자 검토 상태 변경' })
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
  @ApiOperation({ summary: '안전점검 답변 첨부파일 다운로드' })
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
  @ApiOperation({ summary: '안전점검 통계 및 추세 조회' })
  @ApiResponse({ status: 200, type: SafetyChecklistStatisticsDto })
  getStatistics(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: SafetyChecklistStatisticsFilterDto,
  ): Promise<SafetyChecklistStatisticsDto> {
    return this.safetyChecklistsService.getStatistics(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('patterns')
  @ApiOperation({ summary: '안전점검 반복 조치필요 항목 조회' })
  @ApiResponse({ status: 200, type: SafetyChecklistPatternsDto })
  getPatterns(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: SafetyChecklistPatternsFilterDto,
  ): Promise<SafetyChecklistPatternsDto> {
    return this.safetyChecklistsService.getPatterns(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('date-range')
  @ApiOperation({ summary: '안전점검 데이터 날짜 범위 조회' })
  @ApiResponse({ status: 200, type: SafetyChecklistDateRangeDto })
  getDateRange(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: SafetyChecklistStatisticsFilterDto,
  ): Promise<SafetyChecklistDateRangeDto> {
    return this.safetyChecklistsService.getDateRange(filter, req.organizationScopeIds ?? undefined);
  }

  @Get()
  @ApiOperation({ summary: '안전점검 체크리스트 목록 조회' })
  @ApiResponse({ status: 200, type: SafetyChecklistListResponseDto })
  findAll(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: SafetyChecklistFilterDto,
  ): Promise<SafetyChecklistListResponseDto> {
    return this.safetyChecklistsService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Post()
  @PermissionCodes('SAFETY_CHECKLIST_WRITE')
  @ApiOperation({ summary: '안전점검 체크리스트 생성' })
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
  @ApiOperation({ summary: '안전점검 체크리스트 상세 조회' })
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
  @ApiOperation({ summary: '안전점검 체크리스트 수정' })
  @ApiResponse({ status: 200, type: SafetyChecklistDetailDto })
  update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateSafetyChecklistDto,
  ): Promise<SafetyChecklistDetailDto> {
    return this.safetyChecklistsService.update(id, dto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Delete(':id')
  @PermissionCodes('SAFETY_CHECKLIST_WRITE')
  @ApiOperation({ summary: '안전점검 체크리스트 삭제' })
  async remove(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.safetyChecklistsService.remove(id, req.organizationScopeIds ?? undefined, req.user?.id);
    return { success: true };
  }

  @Post(':id/deploy')
  @PermissionCodes('SAFETY_CHECKLIST_WRITE')
  @ApiOperation({ summary: '안전점검 체크리스트 작업자 배포' })
  @ApiResponse({ status: 201, type: SafetyChecklistDetailDto })
  deploy(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: CreateSafetyChecklistDeploymentDto,
  ): Promise<SafetyChecklistDetailDto> {
    return this.safetyChecklistsService.deploy(id, dto, req.organizationScopeIds ?? undefined, req.user?.id);
  }
}
