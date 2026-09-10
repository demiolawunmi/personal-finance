function encode(a: Uint8Array) {
  return btoa(String.fromCharCode(...a));
}
function decode(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
export async function encrypt(value: string, key: string, context: string) {
  const bytes = decode(key);
  if (bytes.length !== 32) throw new Error('INVALID_ENCRYPTION_KEY');
  const cryptoKey = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const result = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    cryptoKey,
    new TextEncoder().encode(value),
  );
  return { ciphertext: encode(new Uint8Array(result)), iv: encode(iv) };
}
export async function decrypt(ciphertext: string, iv: string, key: string, context: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', decode(key), 'AES-GCM', false, [
    'decrypt',
  ]);
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(iv), additionalData: new TextEncoder().encode(context) },
      cryptoKey,
      decode(ciphertext),
    ),
  );
}
export async function sha256(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export const randomToken = () =>
  encode(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
export function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
