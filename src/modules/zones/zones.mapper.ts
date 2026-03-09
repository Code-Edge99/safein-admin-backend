import { ZoneCoordinatePoint, ZoneResponseDto } from './dto';

function parseZoneCoordinates(rawCoordinates: unknown): ZoneCoordinatePoint[] {
  const normalizeArray = (value: unknown): ZoneCoordinatePoint[] => {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((point) => typeof point === 'object' && point !== null)
      .map((point) => {
        const record = point as Record<string, unknown>;
        return {
          lat: typeof record.lat === 'number' ? record.lat : undefined,
          lng: typeof record.lng === 'number' ? record.lng : undefined,
          latitude: typeof record.latitude === 'number' ? record.latitude : undefined,
          longitude: typeof record.longitude === 'number' ? record.longitude : undefined,
        };
      });
  };

  if (typeof rawCoordinates !== 'string') {
    return normalizeArray(rawCoordinates);
  }

  try {
    return normalizeArray(JSON.parse(rawCoordinates));
  } catch {
    return [];
  }
}

export function toZoneResponseDto(zone: any): ZoneResponseDto {
  return {
    id: zone.id,
    name: zone.name,
    description: zone.description,
    type: zone.type,
    shape: zone.shape,
    coordinates: parseZoneCoordinates(zone.coordinates),
    radius: zone.radius,
    bboxMinLat: zone.bboxMinLat ?? undefined,
    bboxMinLng: zone.bboxMinLon ?? undefined,
    bboxMaxLat: zone.bboxMaxLat ?? undefined,
    bboxMaxLng: zone.bboxMaxLon ?? undefined,
    centerLat: zone.centerLat ?? undefined,
    centerLng: zone.centerLon ?? undefined,
    groupId: zone.groupId,
    isActive: zone.isActive,
    organization: zone.organization,
    workType: zone.workType,
    createdAt: zone.createdAt,
    updatedAt: zone.updatedAt,
  };
}
