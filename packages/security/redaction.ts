const secret = /token|secret|authorization|cookie|password|verification|payload/i;
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, secret.test(k) ? '[REDACTED]' : redact(v)]),
    );
  return value;
}
