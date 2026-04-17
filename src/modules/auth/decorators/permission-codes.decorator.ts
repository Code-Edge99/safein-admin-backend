import { SetMetadata } from '@nestjs/common';

export const PERMISSION_CODES_KEY = 'permissionCodes';

export const PermissionCodes = (...codes: string[]) => SetMetadata(PERMISSION_CODES_KEY, codes);