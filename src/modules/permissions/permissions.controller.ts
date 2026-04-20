import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PermissionsService } from './permissions.service';

@ApiTags('권한 관리')
@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('me')
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '현재 로그인 계정의 실효 권한 조회' })
  findMine(@Req() req: AuthenticatedAdminRequest) {
    return this.permissionsService.findMine(req.user);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '권한 목록 조회' })
  findAll() {
    return this.permissionsService.findAll();
  }

  @Put(':id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '권한 수정' })
  update(
    @Param('id') id: string,
    @Body() data: { role: string; enabled: boolean },
  ) {
    return this.permissionsService.update(id, data);
  }

  @Put()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '권한 일괄 수정' })
  bulkUpdate(
    @Body() data: { updates: Array<{ permissionId: string; role: string; enabled: boolean }> },
  ) {
    return this.permissionsService.bulkUpdate(data.updates);
  }
}
