import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsService } from './permissions.service';

@ApiTags('권한 관리')
@Controller('permissions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @ApiOperation({ summary: '권한 목록 조회' })
  findAll() {
    return this.permissionsService.findAll();
  }

  @Put(':id')
  @ApiOperation({ summary: '권한 수정' })
  update(
    @Param('id') id: string,
    @Body() data: { role: string; enabled: boolean },
  ) {
    return this.permissionsService.update(id, data);
  }

  @Put()
  @ApiOperation({ summary: '권한 일괄 수정' })
  bulkUpdate(
    @Body() data: { updates: Array<{ permissionId: string; role: string; enabled: boolean }> },
  ) {
    return this.permissionsService.bulkUpdate(data.updates);
  }
}
