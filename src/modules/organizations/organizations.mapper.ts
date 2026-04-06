import { OrganizationResponseDto } from './dto';

export function toOrganizationResponseDto(org: any): OrganizationResponseDto {
  return {
    id: org.id,
    name: org.name,
    parentId: org.parentId,
    address: org.address,
    detailAddress: org.detailAddress,
    description: org.description,
    managerName: org.managerName,
    managerPhone: org.managerPhone,
    emergencyContact: org.emergencyContact,
    teamCode: org.teamCode,
    isActive: org.isActive,
    createdById: org.createdById,
    updatedById: org.updatedById,
    createdByName: org.createdBy?.name || org.createdBy?.username || '시스템',
    updatedByName: org.updatedBy?.name || org.updatedBy?.username || '시스템',
    employeeCount: org.employeeCount || 0,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  };
}
