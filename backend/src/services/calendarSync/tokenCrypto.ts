import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * OAuth tokens are stored encrypted (AES-256-GCM) and only ever decrypted in memory on the server.
 * The key comes from TOKEN_ENCRYPTION_KEY: 32 random bytes, base64-encoded. Generate one with
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Ciphertext format: v1.<iv b64>.<auth tag b64>.<data b64>
 */
export class TokenKeyError extends Error {
  readonly errorClass = 'TokenKeyError';
}

export function parseKey(raw: string | undefined): Buffer {
  if (!raw) throw new TokenKeyError('TOKEN_ENCRYPTION_KEY is not set. Calendar sync needs it to store sign-in tokens securely.');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new TokenKeyError('TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64-encoded.');
  return key;
}

export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

/** Throws if the data was tampered with or the key changed (GCM authentication). */
export function decrypt(sealed: string, key: Buffer): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new TokenKeyError('Stored token is not in a readable format.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
