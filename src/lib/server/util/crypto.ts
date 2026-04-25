import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptString(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptString(payload: string, secret: string): string {
  const [ivBase64, tagBase64, contentBase64] = payload.split('.');

  if (!ivBase64 || !tagBase64 || !contentBase64) {
    throw new Error('Invalid encrypted payload');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(secret),
    Buffer.from(ivBase64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));

  const content = Buffer.concat([
    decipher.update(Buffer.from(contentBase64, 'base64')),
    decipher.final()
  ]);

  return content.toString('utf8');
}
