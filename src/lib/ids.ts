const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Short, unambiguous room code (6 chars ≈ 887M combinations). */
export function newRoomId(len = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
