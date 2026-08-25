export function isCurrentPgAdminRequest(
  requestSourceKey: string,
  requestId: number,
  currentSourceKey: string,
  currentRequestId: number,
): boolean {
  return requestSourceKey === currentSourceKey && requestId === currentRequestId;
}
