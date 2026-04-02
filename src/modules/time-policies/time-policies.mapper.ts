import { TimePolicyResponseDto, TimeSlotDto } from './dto';

function formatTime(date: Date): string {
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function toTimePolicyResponseDto(policy: any, customTimeSlots?: TimeSlotDto[]): TimePolicyResponseDto {
  const timeSlots: TimeSlotDto[] = customTimeSlots || [
    {
      startTime: formatTime(policy.startTime),
      endTime: formatTime(policy.endTime),
      days: policy.days,
    },
  ];

  const affectedEmployeeCount = 0;

  const formattedExcludePeriods = (policy.excludePeriods || []).map((ep: any) => ({
    id: ep.id,
    reason: ep.reason,
    start: formatTime(ep.startTime),
    end: formatTime(ep.endTime),
  }));

  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    timeSlots,
    priority: 0,
    allowOutsideHours: false,
    organization: policy.organization,
    excludePeriods: formattedExcludePeriods,
    affectedEmployeeCount,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}
