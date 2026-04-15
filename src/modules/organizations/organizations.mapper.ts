import { OrganizationClassificationEnum, OrganizationResponseDto } from './dto';
import { resolveOrganizationClassification } from '../../common/utils/organization-scope.util';

function toClassificationEnum(org: any): OrganizationResponseDto['classification'] {
  const classification = resolveOrganizationClassification(org);
  if (classification === 'ADMIN') return OrganizationClassificationEnum.ADMIN;
  if (classification === 'COMPANY') return OrganizationClassificationEnum.COMPANY;
  if (classification === 'UNIT') return OrganizationClassificationEnum.UNIT;
  return OrganizationClassificationEnum.GROUP;
}

export function toOrganizationResponseDto(org: any): OrganizationResponseDto {
  return {
    id: org.id,
    name: org.name,
    classification: toClassificationEnum(org),
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
