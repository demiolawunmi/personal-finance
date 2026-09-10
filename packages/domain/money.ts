/** Integer micros are the storage boundary; decimal strings are the wire boundary. */
export const SCALE = 1_000_000n;
export function micros(value: string | number): number {
  const raw = String(value);
  const m = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!m) throw new Error('INVALID_MONEY');
  const fraction = m[3] ?? '';
  const exponent = Number(m[4] ?? 0) - fraction.length + 6;
  if (Math.abs(exponent) > 100) throw new Error('MONEY_OUT_OF_RANGE');
  let n = BigInt(m[2] + fraction);
  if (exponent >= 0) n *= 10n ** BigInt(exponent);
  else {
    const divisor = 10n ** BigInt(-exponent);
    if (n % divisor) throw new Error('SUB_MICRO_PRECISION');
    n /= divisor;
  }
  if (m[1] === '-') n = -n;
  return safe(n);
}
export function safe(value: bigint | number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('MONEY_OUT_OF_RANGE');
  return n;
}
export function sum(values: number[]): number {
  return safe(values.reduce((a, b) => a + BigInt(safe(b)), 0n));
}
export function money(amount: number, currency: string) {
  const n = BigInt(safe(amount));
  const a = n < 0n ? -n : n;
  return {
    amount: `${n < 0n ? '-' : ''}${a / SCALE}.${String(a % SCALE).padStart(6, '0')}`,
    currency,
  };
}
export function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}
