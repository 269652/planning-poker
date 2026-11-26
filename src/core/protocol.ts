import { type Card, type NumericCard, isCard, isNumericCard } from "./deck";
import type { RoomView, Role } from "./room";
import type { AgreementRule } from "./stats";

export class ProtocolError extends Error {}

export const MAX_MESSAGE_BYTES = 64 * 1024;
export const MAX_IMPORT_KEYS = 200;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;

export const CLIENT_MESSAGE_TYPES = [
  "join", "vote", "reveal", "nextRound", "nextTicket", "finalize", "reopen", "selectTicket", "removeTicket",
  "addTicket", "importJira", "retryWriteback", "setRule", "raiseHand", "nudge", "ping",
] as const;
export const SERVER_MESSAGE_TYPES = ["welcome", "state", "error", "pong", "nudged"] as const;

export type ClientMessage =
  | { type: "join"; roomId: string; name: string; role: Role; token?: string }
  | { type: "vote"; card: Card }
  | { type: "reveal" }
  | { type: "nextRound" }
  | { type: "nextTicket" }
  | { type: "finalize"; value?: NumericCard }
  | { type: "reopen"; ticketId: string }
  | { type: "selectTicket"; ticketId: string }
  | { type: "removeTicket"; ticketId: string }
  | { type: "addTicket"; title: string; description?: string }
  | { type: "importJira"; issueKeys: string[] }
  | { type: "retryWriteback"; ticketId: string }
  | { type: "setRule"; rule: AgreementRule }
  | { type: "raiseHand"; raised: boolean }
  | { type: "nudge"; participantId?: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "welcome"; token: string; you: string }
  | { type: "state"; room: RoomView }
  | { type: "error"; code: string; message: string }
  | { type: "pong" }
  | { type: "nudged"; from: string };

function str(o: Record<string, unknown>, k: string, max = 500): string {
  const v = o[k];
  if (typeof v !== "string" || v.trim() === "" || v.length > max) throw new ProtocolError(`Invalid or missing "${k}"`);
  return v.trim();
}

export function parseClientMessage(raw: string): ClientMessage {
  if (raw.length > MAX_MESSAGE_BYTES) throw new ProtocolError("Message too large");
  let o: unknown;
  try { o = JSON.parse(raw); } catch { throw new ProtocolError("Malformed JSON"); }
  if (typeof o !== "object" || o === null || Array.isArray(o)) throw new ProtocolError("Message must be an object");
  const m = o as Record<string, unknown>;

  switch (m.type) {
    case "join": {
      const role = m.role === undefined ? "voter" : m.role;
      if (role !== "voter" && role !== "observer") throw new ProtocolError("Invalid role");
      const token = typeof m.token === "string" && m.token ? m.token : undefined;
      return { type: "join", roomId: str(m, "roomId", 64), name: str(m, "name", 40), role, token };
    }
    case "vote":
      if (!isCard(m.card)) throw new ProtocolError("Invalid card");
      return { type: "vote", card: m.card };
    case "reveal": case "nextRound": case "nextTicket": case "ping":
      return { type: m.type };
    case "finalize":
      if (m.value !== undefined && !isNumericCard(m.value)) throw new ProtocolError("Final estimate must be a numeric card");
      return { type: "finalize", value: m.value as NumericCard | undefined };
    case "reopen": case "selectTicket": case "removeTicket": case "retryWriteback":
      return { type: m.type, ticketId: str(m, "ticketId", 100) };
    case "addTicket": {
      const description = typeof m.description === "string" ? m.description.slice(0, 20_000) : undefined;
      return { type: "addTicket", title: str(m, "title", 300), description };
    }
    case "importJira": {
      const keys = m.issueKeys;
      if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_IMPORT_KEYS
        || !keys.every((k) => typeof k === "string" && ISSUE_KEY.test(k))) {
        throw new ProtocolError(`issueKeys must be 1..${MAX_IMPORT_KEYS} valid Jira keys`);
      }
      return { type: "importJira", issueKeys: keys as string[] };
    }
    case "setRule":
      if (m.rule !== "unanimous" && m.rule !== "adjacent") throw new ProtocolError("Invalid rule");
      return { type: "setRule", rule: m.rule };
    case "nudge": {
      if (m.participantId !== undefined && (typeof m.participantId !== "string" || !m.participantId || m.participantId.length > 100)) {
        throw new ProtocolError("participantId must be a participant id");
      }
      return { type: "nudge", participantId: m.participantId as string | undefined };
    }
    case "raiseHand":
      if (typeof m.raised !== "boolean") throw new ProtocolError("raised must be true or false");
      return { type: "raiseHand", raised: m.raised };
    default:
      throw new ProtocolError("Unknown message type");
  }
}
