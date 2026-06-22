import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { CreateDocumentIssueDto, DocumentIssueResponseDto } from './dto';
import { DocumentIssuesService } from './document-issues.service';

@ApiTags('문서 발행')
@Controller('document-issues')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@ApiBearerAuth()
export class DocumentIssuesController {
  constructor(private readonly documentIssuesService: DocumentIssuesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '공용 문서번호 발급 및 발행 이력 저장',
    description:
      'PDF 등 관리자 출력 문서에 사용할 문서번호를 발급하고 발행 이력을 저장합니다. '
      + '문서 종류별 prefix와 날짜별 순번은 서버에서 관리합니다.',
  })
  @ApiBody({ type: CreateDocumentIssueDto })
  @ApiResponse({ status: 201, description: '문서번호 발급 성공', type: DocumentIssueResponseDto })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: '원본 문서 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '원본 문서 없음' })
  async create(
    @Req() req: AuthenticatedAdminRequest,
    @Body() dto: CreateDocumentIssueDto,
  ): Promise<DocumentIssueResponseDto> {
    return this.documentIssuesService.create(req.user, req.organizationScopeIds ?? undefined, dto);
  }
}
