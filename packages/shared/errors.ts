export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function invariant(condition: unknown, status: number, code: string): asserts condition {
  if (!condition) throw new HttpError(status, code);
}
export async function readBody(request: Request, maxBytes = 65536) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'BODY_TOO_LARGE');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let i = 0;
  for (const chunk of chunks) {
    out.set(chunk, i);
    i += chunk.length;
  }
  return new TextDecoder().decode(out);
}
