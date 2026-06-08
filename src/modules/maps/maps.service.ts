import { Injectable, BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface NcpGeocodeResponse {
  status?: string;
  addresses?: Array<{
    roadAddress?: string;
    jibunAddress?: string;
    x?: string;
    y?: string;
  }>;
}

@Injectable()
export class MapsService {
  constructor(private readonly configService: ConfigService) {}

  private getCredentials() {
    const keyId = this.configService.get<string>('NCP_MAPS_API_KEY_ID');
    const key = this.configService.get<string>('NCP_MAPS_API_KEY');

    if (!keyId || !key) {
      throw new ServiceUnavailableException(
        '지도 API 설정이 누락되었습니다. 관리자에게 문의해주세요.',
      );
    }

    return { keyId, key };
  }

  async geocode(query: string): Promise<{ lat: number; lng: number; roadAddress: string; jibunAddress: string } | null> {
    const { keyId, key } = this.getCredentials();

    const endpoint = new URL('https://maps.apigw.ntruss.com/map-geocode/v2/geocode');
    endpoint.searchParams.set('query', query);

    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        'x-ncp-apigw-api-key-id': keyId,
        'x-ncp-apigw-api-key': key,
      },
    });

    if (!response.ok) {
      throw new BadGatewayException(`주소 검색 서버 요청에 실패했습니다. (status=${response.status})`);
    }

    const payload = (await response.json()) as NcpGeocodeResponse;
    const item = payload?.addresses?.[0];

    if (!item) {
      return null;
    }

    const lat = Number(item.y);
    const lng = Number(item.x);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    return {
      lat,
      lng,
      roadAddress: item.roadAddress ?? '',
      jibunAddress: item.jibunAddress ?? '',
    };
  }
}
