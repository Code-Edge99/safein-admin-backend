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
import { HarmfulAppsService } from './harmful-apps.service';
import {
  CreateHarmfulAppDto,
  UpdateHarmfulAppDto,
  HarmfulAppResponseDto,
  HarmfulAppFilterDto,
  HarmfulAppListResponseDto,
} from './dto';

@ApiTags('유해 앱')
@Controller('harmful-apps')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@ApiBearerAuth()
export class HarmfulAppsController {
  constructor(private readonly harmfulAppsService: HarmfulAppsService) {}

  @Post()
  @ApiOperation({ summary: '유해 앱 등록' })
  @ApiResponse({ status: 201, type: HarmfulAppResponseDto })
  create(@Body() dto: CreateHarmfulAppDto): Promise<HarmfulAppResponseDto> {
    return this.harmfulAppsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: '유해 앱 목록 조회' })
  @ApiResponse({ status: 200, type: HarmfulAppListResponseDto })
  findAll(@Query() filter: HarmfulAppFilterDto): Promise<HarmfulAppListResponseDto> {
    return this.harmfulAppsService.findAll(filter);
  }

  @Get('categories')
  @ApiOperation({ summary: '유해 앱 카테고리 목록' })
  @ApiResponse({ status: 200, type: [String] })
  getCategories(): Promise<string[]> {
    return this.harmfulAppsService.getCategories();
  }

  @Get('package/:packageName')
  @ApiOperation({ summary: '패키지 이름으로 유해 앱 조회' })
  @ApiResponse({ status: 200, type: HarmfulAppResponseDto })
  findByPackageName(@Param('packageName') packageName: string): Promise<HarmfulAppResponseDto> {
    return this.harmfulAppsService.findByPackageName(packageName);
  }

  @Get(':id')
  @ApiOperation({ summary: '유해 앱 상세 조회' })
  @ApiResponse({ status: 200, type: HarmfulAppResponseDto })
  findOne(@Param('id') id: string): Promise<HarmfulAppResponseDto> {
    return this.harmfulAppsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '유해 앱 수정' })
  @ApiResponse({ status: 200, type: HarmfulAppResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateHarmfulAppDto,
  ): Promise<HarmfulAppResponseDto> {
    return this.harmfulAppsService.update(id, dto);
  }

  @Patch(':id/toggle-global')
  @ApiOperation({ summary: '전역 앱 설정 토글' })
  @ApiResponse({ status: 200, type: HarmfulAppResponseDto })
  toggleGlobal(@Param('id') id: string): Promise<HarmfulAppResponseDto> {
    return this.harmfulAppsService.toggleGlobal(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '유해 앱 삭제' })
  @ApiResponse({ status: 204 })
  remove(@Param('id') id: string): Promise<void> {
    return this.harmfulAppsService.remove(id);
  }
}
