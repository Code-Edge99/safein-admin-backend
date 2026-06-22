import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentIssueType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedAdminUser } from '../../common/types/authenticated-request.type';
import { CreateDocumentIssueDto, DocumentIssueResponseDto } from './dto';

type ResolvedIssueSource = {
  sourceTitle: string | null;
  organizationId: string | null;
  organizationName: string | null;
};

const DOCUMENT_TYPE_PREFIX: Record<DocumentIssueType, string> = {
  [DocumentIssueType.TBM_REPORT]: 'SAFEIN-TBM',
};

@Injectable()
export class DocumentIssuesService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
    const trimmed = String(value ?? '').trim();
    return trimmed ? trimmed.slice(0, maxLength) : null;
  }

  private formatKstDateCompact(value: Date): string {
    const kstDate = new Date(value.getTime() + (9 * 60 * 60 * 1000));
    const year = kstDate.getUTCFullYear();
    const month = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kstDate.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private buildDocumentNumber(documentType: DocumentIssueType, issuedDate: string, sequence: number): string {
    return `${DOCUMENT_TYPE_PREFIX[documentType]}-${issuedDate}-${String(sequence).padStart(6, '0')}`;
  }

  private isTbmInScope(row: {
    organizationId: string | null;
    authorOrganizationIdAtCreate: string | null;
    participants: Array<{ organizationIdAtAssign: string | null }>;
  }, scopeOrganizationIds: string[] | undefined): boolean {
    if (!scopeOrganizationIds) {
      return true;
    }

    const scope = new Set(scopeOrganizationIds);
    return (!!row.organizationId && scope.has(row.organizationId))
      || (!!row.authorOrganizationIdAtCreate && scope.has(row.authorOrganizationIdAtCreate))
      || row.participants.some((participant) => (
        !!participant.organizationIdAtAssign && scope.has(participant.organizationIdAtAssign)
      ));
  }

  private async resolveSource(
    documentType: DocumentIssueType,
    sourceId: string,
    scopeOrganizationIds: string[] | undefined,
  ): Promise<ResolvedIssueSource> {
    if (documentType === DocumentIssueType.TBM_REPORT) {
      const row = await this.prisma.tbmSession.findFirst({
        where: { id: sourceId, deletedAt: null },
        select: {
          title: true,
          organizationId: true,
          organizationNameAtCreate: true,
          authorOrganizationIdAtCreate: true,
          participants: {
            select: { organizationIdAtAssign: true },
          },
        },
      });

      if (!row) {
        throw new NotFoundException('문서 원본 TBM을 찾을 수 없습니다.');
      }

      if (!this.isTbmInScope(row, scopeOrganizationIds)) {
        throw new ForbiddenException('문서 원본 TBM에 접근할 권한이 없습니다.');
      }

      return {
        sourceTitle: row.title,
        organizationId: row.organizationId,
        organizationName: row.organizationNameAtCreate,
      };
    }

    return {
      sourceTitle: null,
      organizationId: null,
      organizationName: null,
    };
  }

  async create(
    user: AuthenticatedAdminUser | undefined,
    scopeOrganizationIds: string[] | undefined,
    dto: CreateDocumentIssueDto,
  ): Promise<DocumentIssueResponseDto> {
    const issuedAt = new Date();
    const issuedDate = this.formatKstDateCompact(issuedAt);
    const sourceId = this.normalizeOptionalText(dto.sourceId, 100);

    if (!sourceId) {
      throw new BadRequestException('문서 원본 ID를 확인할 수 없습니다.');
    }

    const [account, source] = await Promise.all([
      user?.id
        ? this.prisma.account.findUnique({
            where: { id: user.id },
            select: {
              id: true,
              name: true,
              organizationId: true,
              organization: { select: { id: true, name: true } },
            },
          })
        : null,
      this.resolveSource(dto.documentType, sourceId, scopeOrganizationIds),
    ]);

    const issuerName = this.normalizeOptionalText(dto.issuerName, 80)
      ?? account?.name
      ?? user?.id
      ?? '출력자 미확인';
    const sourceTitle = this.normalizeOptionalText(dto.sourceTitle, 200) ?? source.sourceTitle;
    const organizationId = account?.organizationId ?? source.organizationId;
    const organizationName = account?.organization?.name ?? source.organizationName;

    const issue = await this.prisma.$transaction(async (tx) => {
      const sequence = await tx.documentIssueSequence.upsert({
        where: {
          documentType_issuedDate: {
            documentType: dto.documentType,
            issuedDate,
          },
        },
        create: {
          documentType: dto.documentType,
          issuedDate,
          lastSequence: 1,
        },
        update: {
          lastSequence: { increment: 1 },
        },
      });

      const documentNumber = this.buildDocumentNumber(dto.documentType, issuedDate, sequence.lastSequence);

      return tx.documentIssue.create({
        data: {
          documentNumber,
          documentType: dto.documentType,
          sourceId,
          sourceTitle,
          issuerAccountId: account?.id ?? null,
          issuerNameAtIssue: issuerName,
          organizationId,
          organizationNameAtIssue: organizationName,
          issuedAt,
          metadata: (dto.metadata ?? { format: 'pdf' }) as Prisma.InputJsonValue,
        },
      });
    });

    return {
      id: issue.id,
      documentNumber: issue.documentNumber,
      documentType: issue.documentType,
      sourceId: issue.sourceId,
      sourceTitle: issue.sourceTitle,
      issuerName: issue.issuerNameAtIssue,
      issuedAt: issue.issuedAt,
    };
  }
}
