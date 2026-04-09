import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedAdminRequest } from '../../../common/types/authenticated-request.type';

@Injectable()
export class OrganizationScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedAdminRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('인증 정보가 없습니다.');
    }

    if (user.role === AdminRole.SUPER_ADMIN) {
      request.organizationScopeIds = undefined;
      return true;
    }

    if (!user.organizationId) {
      throw new ForbiddenException('소속 사업장 정보가 없는 계정은 접근할 수 없습니다.');
    }

    const rootOrganization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { id: true, isActive: true },
    });

    if (!rootOrganization || !rootOrganization.isActive) {
      throw new ForbiddenException('유효하지 않은 현장 정보입니다.');
    }

    const scopeIds = await this.collectDescendantOrganizationIds(rootOrganization.id);
    request.organizationScopeIds = scopeIds;

    this.validateRequestedOrganization(request, scopeIds);

    return true;
  }

  private async collectDescendantOrganizationIds(rootId: string): Promise<string[]> {
    const visited = new Set<string>([rootId]);
    let frontier = [rootId];

    while (frontier.length > 0) {
      const children = await this.prisma.organization.findMany({
        where: {
          parentId: { in: frontier },
          isActive: true,
        },
        select: { id: true },
      });

      const nextFrontier: string[] = [];
      for (const child of children) {
        if (!visited.has(child.id)) {
          visited.add(child.id);
          nextFrontier.push(child.id);
        }
      }

      frontier = nextFrontier;
    }

    return Array.from(visited);
  }

  private validateRequestedOrganization(request: AuthenticatedAdminRequest, scopeIds: string[]): void {
    const requestedIds = new Set<string>();

    const addIfString = (value: unknown) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        requestedIds.add(value.trim());
      }
    };

    const addStringArray = (value: unknown) => {
      if (Array.isArray(value)) {
        for (const item of value) {
          addIfString(item);
        }
      }
    };

    addIfString(request.params?.orgId);
    addIfString(request.params?.organizationId);
    addIfString(request.query?.orgId);
    addIfString(request.query?.organizationId);
    addIfString(request.body?.organizationId);
    addIfString(request.body?.orgId);
    addStringArray(request.body?.organizationIds);

    for (const requestedId of requestedIds) {
      if (!scopeIds.includes(requestedId)) {
        throw new ForbiddenException('요청한 현장은 접근 권한 범위를 벗어났습니다.');
      }
    }
  }
}