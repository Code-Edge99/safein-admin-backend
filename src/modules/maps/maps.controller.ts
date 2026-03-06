import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GeocodeQueryDto } from './dto/geocode-query.dto';
import { MapsService } from './maps.service';

@ApiTags('Maps')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('maps')
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  @Get('geocode')
  @ApiOperation({ summary: 'NCP Maps Geocoding 프록시' })
  @ApiQuery({ name: 'query', required: true, description: '검색할 주소 문자열' })
  @ApiResponse({
    status: 200,
    description: '좌표 변환 결과',
    schema: {
      type: 'object',
      nullable: true,
      properties: {
        lat: { type: 'number', example: 37.5665 },
        lng: { type: 'number', example: 126.978 },
        roadAddress: { type: 'string', example: '서울특별시 중구 세종대로 110' },
        jibunAddress: { type: 'string', example: '서울특별시 중구 태평로1가 31' },
      },
    },
  })
  async geocode(@Query() queryDto: GeocodeQueryDto) {
    return this.mapsService.geocode(queryDto.query);
  }
}
