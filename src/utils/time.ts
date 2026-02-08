export function isoNow(): string {
  return new Date().toISOString();
}

export function manualSessionId(date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `manual-${yyyy}-${mm}-${dd}`;
}
