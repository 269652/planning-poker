// No 0/O/1/I/L: room codes are read aloud and typed by humans.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE = /^[A-HJKMNP-Z2-9]{8}$/;

export function newRoomId(): string {
  const bytes = new Uint32Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * The host registers this id with the PeerJS signaling server, so the room code alone is
 * everything a guest needs to find the host.
 */
export function peerIdFor(roomId: string): string {
  return `ppoker-${roomId.toUpperCase()}`;
}

/** Accepts a code ("abcd2345"), "#ABCD2345" or a full invite link. */
export function parseRoomCode(input: string): string | null {
  const s = input.trim();
  const candidate = (s.includes("#") ? s.slice(s.lastIndexOf("#") + 1) : s).trim().toUpperCase();
  return CODE.test(candidate) ? candidate : null;
}
