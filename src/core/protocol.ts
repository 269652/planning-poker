import { type Card, type NumericCard, isCard, isNumericCard } from "./deck";
import { CHAT_MAX_LENGTH, type RoomView, type Role } from "./room";
import type { AgreementRule } from "./stats";

export class ProtocolError extends Error {}

// Room for one chat image (MAX_IMAGE_CHARS) plus text; the relay carries up to 200 KiB per message.
export const MAX_MESSAGE_BYTES = 160 * 1024;
/** A chat image as a data URL; the app shrinks pasted images to fit. */
export const MAX_IMAGE_CHARS = 140_000;
// Raster formats only (SVG could carry scripts), base64 only.
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
export const MAX_IMPORT_KEYS = 200;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;

export const CLIENT_MESSAGE_TYPES = [
  "join", "vote", "reveal", "nextRound", "nextTicket", "finalize", "reopen", "selectTicket", "removeTicket",
  "addTicket", "importJira", "retryWriteback", "setRule", "raiseHand", "nudge", "chat", "react", "leave", "setModerator", "jira", "ping",
] as const;
export const SERVER_MESSAGE_TYPES = ["welcome", "state", "error", "pong", "nudged", "image", "jiraResult"] as const;

/** Jira reads a PM may run through the host's helper (writing to Jira stays with the host). */
export const JIRA_PROXY_OPS = ["searchBoards", "listBoards", "getBoard", "listSprints", "listIssues"] as const;
export type JiraProxyOp = (typeof JIRA_PROXY_OPS)[number];

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
  | { type: "chat"; text: string; image?: string }
  | { type: "react"; messageId: string; emoji: string }
  /** The tab is closing: leave the room now (a later message on the same connection rejoins). */
  | { type: "leave" }
  /** Host only: appoint or remove a PM. */
  | { type: "setModerator"; participantId: string; moderator: boolean }
  /** PM: a Jira read through the host's helper; answered with `jiraResult` (same `reqId`). */
  | { type: "jira"; reqId: string; op: JiraProxyOp; args: (string | number | Record<string, unknown>)[] }
  | { type: "ping" };

export type ServerMessage =
  | { type: "welcome"; token: string; you: string }
  | { type: "state"; room: RoomView }
  | { type: "error"; code: string; message: string }
  | { type: "pong" }
  | { type: "nudged"; from: string }
  /** A chat image (sent once when posted, and to everyone who joins while the host still has it). */
  | { type: "image"; id: string; data: string }
  /** The answer to a PM's `jira` request. */
  | { type: "jiraResult"; reqId: string; ok: true; data: unknown } | { type: "jiraResult"; reqId: string; ok: false; error: string };

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
    case "reveal": case "nextRound": case "nextTicket": case "ping": case "leave":
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
    case "react":
      return { type: "react", messageId: str(m, "messageId", 100), emoji: str(m, "emoji", 16) };
    case "setModerator":
      if (typeof m.moderator !== "boolean") throw new ProtocolError("moderator must be true or false");
      return { type: "setModerator", participantId: str(m, "participantId", 100), moderator: m.moderator };
    case "jira": {
      const op = m.op;
      if (!(JIRA_PROXY_OPS as readonly unknown[]).includes(op)) throw new ProtocolError("Unknown Jira operation");
      const args = m.args === undefined ? [] : m.args;
      const okArg = (a: unknown) => (typeof a === "string" && a.length <= 200) || (typeof a === "number" && Number.isFinite(a))
        || (typeof a === "object" && a !== null && !Array.isArray(a) && JSON.stringify(a).length <= 500);
      if (!Array.isArray(args) || args.length > 3 || !args.every(okArg)) throw new ProtocolError("Invalid Jira arguments");
      return { type: "jira", reqId: str(m, "reqId", 40), op: op as JiraProxyOp, args: args as (string | number | Record<string, unknown>)[] };
    }
    case "chat": {
      const image = m.image;
      if (image !== undefined && (typeof image !== "string" || image.length > MAX_IMAGE_CHARS || !IMAGE_DATA_URL.test(image))) {
        throw new ProtocolError("image must be a PNG, JPEG, WebP or GIF data URL of at most ~100 KB");
      }
      // With an image, the text may be empty.
      const text = image !== undefined && (m.text === undefined || m.text === "") ? "" : str(m, "text", CHAT_MAX_LENGTH);
      return image === undefined ? { type: "chat", text } : { type: "chat", text, image };
    }
    default:
      throw new ProtocolError("Unknown message type");
  }
}
