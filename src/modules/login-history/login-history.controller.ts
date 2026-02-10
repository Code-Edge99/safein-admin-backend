import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LoginHistoryService } from './login-history.service';

@ApiTags('로그인 이력')
@Controller('login-history')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LoginHistoryController {
  constructor(private readonly loginHistoryService: LoginHistoryService) {}

  @Get()
  @ApiOperation({ summary: '로그인 이력 목록 조회' })
  findAll(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('accountId') accountId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.loginHistoryService.findAll({
      search,
      status,
      accountId,
      startDate,
      endDate,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '로그인 이력 상세 조회' })
  findOne(@Param('id') id: string) {
    return this.loginHistoryService.findOne(id);
  }
}
