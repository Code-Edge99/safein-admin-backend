export function toLoginHistoryResponseDto(log: any) {
  return {
    id: log.id,
    accountId: log.accountId,
    employeeName: log.account?.name || '',
    employeeId: log.account?.username || '',
    role: log.account?.role || '',
    loginTime: log.loginTime,
    ipAddress: log.ipAddress || '',
    userAgent: log.userAgent || '',
    status: log.status,
    failReason: log.failReason,
    location: log.ipAddress ? `IP: ${log.ipAddress}` : '',
    deviceInfo: log.userAgent || '',
    createdAt: log.createdAt,
  };
}
