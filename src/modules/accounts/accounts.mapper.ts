import { AccountResponseDto, AccountStatusEnum, AdminRoleEnum } from './dto';

export function toAccountResponseDto(account: any): AccountResponseDto {
  return {
    id: account.id,
    username: account.username,
    name: account.name,
    email: account.email,
    phone: account.phone,
    role: account.role as AdminRoleEnum,
    organization: account.organization,
    status: account.status as AccountStatusEnum,
    lastLogin: account.lastLogin,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
