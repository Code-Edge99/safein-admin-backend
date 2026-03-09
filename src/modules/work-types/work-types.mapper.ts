import { WorkTypeResponseDto } from './dto';

export function toWorkTypeResponseDto(workType: any): WorkTypeResponseDto {
  return {
    id: workType.id,
    name: workType.name,
    description: workType.description,
    organizationId: workType.organizationId,
    organizationName: workType.organization?.name,
    isActive: workType.isActive,
    createdAt: workType.createdAt,
    updatedAt: workType.updatedAt,
    employeeCount: workType._count?.employees,
    hasPolicy: !!workType.controlPolicy,
  };
}
