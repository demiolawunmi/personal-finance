import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose';
import { PlaidClient } from './client';
import { equal, sha256 } from '../security/crypto';
import { HttpError } from '../shared/errors';
export async function verifyWebhook(
  raw: string,
  jwt: string | null,
  client: PlaidClient,
  now = new Date(),
) {
  try {
    if (!jwt) throw new Error();
    const header = decodeProtectedHeader(jwt);
    if (header.alg !== 'ES256' || !header.kid) throw new Error();
    const { key } = await client.call<{ key: JWK & { expired_at?: number | null } }>(
      '/webhook_verification_key/get',
      { key_id: header.kid },
    );
    if (key.expired_at != null && key.expired_at <= now.getTime() / 1000) throw new Error();
    const publicKey = await importJWK(key, 'ES256');
    const { payload } = await jwtVerify(jwt, publicKey, {
      algorithms: ['ES256'],
      maxTokenAge: 300,
      currentDate: now,
      clockTolerance: 0,
    });
    if (
      typeof payload.iat !== 'number' ||
      payload.iat > now.getTime() / 1000 ||
      typeof payload.request_body_sha256 !== 'string' ||
      !equal(await sha256(raw), payload.request_body_sha256)
    )
      throw new Error();
    return JSON.parse(raw) as {
      webhook_type: string;
      webhook_code: string;
      item_id?: string;
      error?: { error_code?: string };
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'PLAID_UNAVAILABLE') throw error;
    throw new HttpError(401, 'INVALID_WEBHOOK');
  }
}
