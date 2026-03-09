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
        'NCP Maps API credentials are missing (NCP_MAPS_API_KEY_ID / NCP_MAPS_API_KEY).',
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
      throw new BadGatewayException(`NCP geocode request failed with status ${response.status}`);
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
