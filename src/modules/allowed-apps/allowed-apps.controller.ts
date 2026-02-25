import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AllowedAppsService } from './allowed-apps.service';
import {
  CreateAllowedAppDto,
  UpdateAllowedAppDto,
  AllowedAppResponseDto,
  AllowedAppFilterDto,
  AllowedAppListResponseDto,
  RefreshAllowedAppIconsDto,
  RefreshAllowedAppIconsResponseDto,
} from './dto';

@ApiTags('허용앱')
@Controller('allowed-apps')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@ApiBearerAuth()
export class AllowedAppsController {
  constructor(private readonly allowedAppsService: AllowedAppsService) {}

  @Post()
  @ApiOperation({ summary: '허용앱 등록' })
  @ApiResponse({ status: 201, type: AllowedAppResponseDto })
  create(@Body() dto: CreateAllowedAppDto): Promise<AllowedAppResponseDto> {
    return this.allowedAppsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: '허용앱 목록 조회' })
  @ApiResponse({ status: 200, type: AllowedAppListResponseDto })
  findAll(@Query() filter: AllowedAppFilterDto): Promise<AllowedAppListResponseDto> {
    return this.allowedAppsService.findAll(filter);
  }

  @Get('categories')
  @ApiOperation({ summary: '허용앱 카테고리 목록' })
  @ApiResponse({ status: 200, type: [String] })
  getCategories(): Promise<string[]> {
    return this.allowedAppsService.getCategories();
  }

  @Get('package/:packageName')
  @ApiOperation({ summary: '패키지 이름으로 허용앱 조회' })
  @ApiResponse({ status: 200, type: AllowedAppResponseDto })
  findByPackageName(@Param('packageName') packageName: string): Promise<AllowedAppResponseDto> {
    return this.allowedAppsService.findByPackageName(packageName);
  }

  @Get(':id')
  @ApiOperation({ summary: '허용앱 상세 조회' })
  @ApiResponse({ status: 200, type: AllowedAppResponseDto })
  findOne(@Param('id') id: string): Promise<AllowedAppResponseDto> {
    return this.allowedAppsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '허용앱 수정' })
  @ApiResponse({ status: 200, type: AllowedAppResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAllowedAppDto,
  ): Promise<AllowedAppResponseDto> {
    return this.allowedAppsService.update(id, dto);
  }

  @Patch(':id/toggle-global')
  @ApiOperation({ summary: '전역 허용앱 설정 토글' })
  @ApiResponse({ status: 200, type: AllowedAppResponseDto })
  toggleGlobal(@Param('id') id: string): Promise<AllowedAppResponseDto> {
    return this.allowedAppsService.toggleGlobal(id);
  }

  @Post('refresh-icons')
  @ApiOperation({ summary: '앱 정보 최신화 (스토어 아이콘 갱신)' })
  @ApiResponse({ status: 200, type: RefreshAllowedAppIconsResponseDto })
  refreshIcons(
    @Body() dto: RefreshAllowedAppIconsDto,
  ): Promise<RefreshAllowedAppIconsResponseDto> {
    return this.allowedAppsService.refreshIcons(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '허용앱 삭제' })
  @ApiResponse({ status: 204 })
  remove(@Param('id') id: string): Promise<void> {
    return this.allowedAppsService.remove(id);
  }
}
