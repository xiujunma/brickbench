/** Random ids and secrets, and the encodings they travel in. */

/** Letters and digits that cannot be mistaken for each other: Crockford's base32, in lower case. */
const ID_LETTERS = '0123456789abcdefghjkmnpqrstvwxyz';

function randomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count));
}

/** A new id for an account or a model: 16 characters, 80 random bits. */
export function newId(): string {
  let bits = 0;
  let value = 0;
  let id = '';
  for (const byte of randomBytes(10)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      id += ID_LETTERS[(value >> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  return id;
}

export function toBase64Url(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The bytes base64url text holds; null when it holds none. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** A secret for a cookie or a sign-in: 256 random bits. */
export function newSecret(): string {
  return toBase64Url(randomBytes(32));
}

/** SHA-256 in base64url: what the database keeps of a session's secret, so a copy of it signs no one in. */
export async function digest(text: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/** Compares secrets in time that does not depend on where they differ. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
