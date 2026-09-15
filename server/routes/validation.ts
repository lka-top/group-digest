export function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function asFiniteNumber(
  value: unknown,
  options: { integer?: boolean; min?: number; max?: number } = {}
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  if (options.integer && !Number.isInteger(parsed)) return undefined;
  if (options.min !== undefined && parsed < options.min) return undefined;
  if (options.max !== undefined && parsed > options.max) return undefined;
  return parsed;
}

export function asBooleanInt(value: unknown): 0 | 1 | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return undefined;
}

export function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && Number.isFinite(Date.parse(value));
}

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
