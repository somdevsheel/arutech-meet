const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
} as const;

type DurationUnit = keyof typeof UNIT_MS;

/** Parses a short duration string ("15m", "30d", "1h") into milliseconds. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration string: "${value}"`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit as DurationUnit];
}
