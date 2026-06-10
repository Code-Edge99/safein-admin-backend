import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CommonCodesService } from './common-codes.service';
import { CommonCodeFilterDto, CommonCodeGroupDto } from './dto';

@ApiTags('Common Codes')
@Controller('common-codes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CommonCodesController {
  constructor(private readonly commonCodesService: CommonCodesService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: 'List common code groups' })
  @ApiResponse({ status: 200, type: [CommonCodeGroupDto] })
  findAll(@Query() filter: CommonCodeFilterDto): Promise<CommonCodeGroupDto[]> {
    return this.commonCodesService.findAll(filter.groupKeys);
  }

  @Get(':groupKey')
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: 'Get one common code group' })
  @ApiResponse({ status: 200, type: CommonCodeGroupDto })
  findOne(@Param('groupKey') groupKey: string): Promise<CommonCodeGroupDto> {
    return this.commonCodesService.findOne(groupKey);
  }
}
