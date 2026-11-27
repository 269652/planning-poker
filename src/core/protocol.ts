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
  "addTicket", "importJira", "retryWriteback", "setRule", "raiseHand", "nudge", "chat", "react", "leave", "setModerator", "jira", "stream", "cursor", "ping",
] as const;
export const SERVER_MESSAGE_TYPES = ["welcome", "state", "error", "pong", "nudged", "image", "jiraResult", "stream", "cursor"] as const;

/**
 * Where someone's mouse is in the room: the spot in their window, shown at the same spot of everyone
 * else's window. Over the card pane only `cards: true` is sent — being there is shown, *where* is
 * not (it would hint at the card). `null`: the mouse left the window or the tab is in the background.
 */
export type BoardSpot = {
  /** The spot in the window (0..1 of width and height); shown at the same spot of others' windows (vw/vh). */
  x: number; y: number;
  /** Over the card pane: only *that* they're there. */
  cards?: true;
};

/** One row of a streamed Jira import list. */
export interface StreamIssue { key: string; summary: string; issueType: string; status: string; estimate: number | null; inSession: boolean }
/** What a PM shows everyone while streaming the import dialog. */
export interface StreamList {
  /** Board and what is listed (backlog, sprint, all open issues). */
  title: string;
  /** What the streamer is typing into the search field (live). */
  query: string;
  /** The board and "From" fields as the streamer sees them (optional for older clients). */
  filters?: StreamFilters;
  /** The row the streamer has opened, with the ticket's description (Jira markup, shortened). */
  expanded?: { key: string; text: string };
  issues: StreamIssue[];
  picked: string[];
}
/**
 * The PM's ghost cursor (relative to the dialog) and how far the ticket list is scrolled, all 0..1,
 * so it maps onto any screen size.
 */
export interface StreamPointer {
  x: number; y: number; scroll: number;
  /**
   * Over a ticket row: its key and where within the row (rx, ry: 0..1 of its width and height) — so
   * the ghost lands on the same spot of the same row on any screen size and scroll offset.
   */
  row?: string; rx?: number; ry?: number;
  /**
   * With `row`: the cursor is over that row's opened description — rx/ry are then relative to the
   * whole description text (scrolled-away part included), so it lands on the same words anywhere.
   */
  detail?: boolean;
  /**
   * With `detail`: which block of the description (paragraph, list item, heading, code, cell — in
   * document order) the cursor is over; rx/ry are then relative to that block. Text wraps
   * differently on other screen widths; the block is the same everywhere.
   */
  block?: number;
  /** Over a part of the dialog other than a row (header, filters, search, footer): which one; rx/ry within it. */
  anchor?: StreamAnchor;
  /** Presenter: how far the opened description is scrolled (0..1). */
  detailScroll?: number;
  /** The row at the top of the list and how much of it is scrolled away (0..1). */
  topRow?: string; topOff?: number;
}
/** Named parts of the import dialog (both views mark them with `data-anchor`). */
export const STREAM_ANCHORS = ["head", "board", "from", "search", "list", "foot"] as const;
export type StreamAnchor = (typeof STREAM_ANCHORS)[number];
/** What the streamer's dialog shows above the list, so the live view can mirror it line for line. */
export interface StreamFilters { board: string; from: string; searching: boolean }
export type StreamPayload = { kind: "list"; list: StreamList } | { kind: "pointer"; pointer: StreamPointer } | { kind: "end" };
export const MAX_STREAM_ISSUES = 300;

/** Jira reads a PM may run through the host's helper (writing to Jira stays with the host). */
export const JIRA_PROXY_OPS = ["searchBoards", "listBoards", "getBoard", "listSprints", "listIssues", "getIssue"] as const;
/** Descriptions travel to PMs and into the stream at most this long. */
export const MAX_DESCRIPTION_CHARS = 8000;
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
  /** Anyone: your mouse in the room (relayed to everyone else; nothing is stored). */
  | { type: "cursor"; spot: BoardSpot | null }
  /** Host or PM: stream the import dialog (list, checkboxes, scroll, cursor) to everyone else. */
  | ({ type: "stream" } & StreamPayload)
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
  /** Someone's mouse in the room (`spot: null` = gone). */
  | { type: "cursor"; from: string; name: string; spot: BoardSpot | null }
  /** Someone (host or PM) is streaming their import dialog. */
  | ({ type: "stream"; from: string; name: string } & StreamPayload)
  /** The answer to a PM's `jira` request. */
  | { type: "jiraResult"; reqId: string; ok: true; data: unknown } | { type: "jiraResult"; reqId: string; ok: false; error: string };

function str(o: Record<string, unknown>, k: string, max = 500): string {
  const v = o[k];
  if (typeof v !== "string" || v.trim() === "" || v.length > max) throw new ProtocolError(`Invalid or missing "${k}"`);
  return v.trim();
}

const unit = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function parseStream(m: Record<string, unknown>): StreamPayload {
  if (m.kind === "end") return { kind: "end" };
  if (m.kind === "pointer") {
    const p = (m.pointer ?? {}) as Record<string, unknown>;
    const key = (v: unknown) => (typeof v === "string" && ISSUE_KEY.test(v) ? v : undefined);
    const row = key(p.row), topRow = key(p.topRow);
    return {
      kind: "pointer",
      pointer: {
        x: unit(p.x), y: unit(p.y), scroll: unit(p.scroll),
        ...(row ? {
          row, rx: unit(p.rx), ry: unit(p.ry),
          ...(p.detail === true ? { detail: true } : {}),
          ...(p.detail === true && Number.isInteger(p.block) && (p.block as number) >= 0 && (p.block as number) < 5000 ? { block: p.block as number } : {}),
        } : {}),
        ...(p.detailScroll !== undefined ? { detailScroll: unit(p.detailScroll) } : {}),
        ...(!row && (STREAM_ANCHORS as readonly unknown[]).includes(p.anchor) ? { anchor: p.anchor as StreamAnchor, rx: unit(p.rx), ry: unit(p.ry) } : {}),
        ...(topRow ? { topRow, topOff: unit(p.topOff) } : {}),
      },
    };
  }
  if (m.kind !== "list") throw new ProtocolError("stream kind must be list, pointer or end");
  const l = m.list as Record<string, unknown> | undefined;
  if (!l || !Array.isArray(l.issues) || !Array.isArray(l.picked) || l.issues.length > MAX_STREAM_ISSUES || l.picked.length > MAX_STREAM_ISSUES) {
    throw new ProtocolError(`stream list must have at most ${MAX_STREAM_ISSUES} issues`);
  }
  const issues = l.issues.map((raw) => {
    const i = (raw ?? {}) as Record<string, unknown>;
    if (typeof i.key !== "string" || !ISSUE_KEY.test(i.key)) throw new ProtocolError("stream issues need Jira keys");
    return {
      key: i.key, summary: text(i.summary, 300), issueType: text(i.issueType, 40), status: text(i.status, 40),
      estimate: typeof i.estimate === "number" && Number.isFinite(i.estimate) ? i.estimate : null, inSession: i.inSession === true,
    };
  });
  const picked = l.picked.filter((k): k is string => typeof k === "string" && ISSUE_KEY.test(k));
  const f = l.filters as Record<string, unknown> | undefined;
  const filters = f && typeof f === "object" ? { board: text(f.board, 120), from: text(f.from, 120), searching: f.searching === true } : undefined;
  const e = l.expanded as Record<string, unknown> | undefined;
  const expanded = e && typeof e.key === "string" && ISSUE_KEY.test(e.key) ? { key: e.key, text: text(e.text, MAX_DESCRIPTION_CHARS) } : undefined;
  return {
    kind: "list",
    list: { title: text(l.title, 200), query: text(l.query, 200), ...(filters ? { filters } : {}), ...(expanded ? { expanded } : {}), issues, picked },
  };
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
    case "stream":
      return { type: "stream", ...parseStream(m) };
    case "cursor": {
      if (m.spot === null) return { type: "cursor", spot: null };
      const s = (m.spot ?? {}) as Record<string, unknown>;
      if (s.cards === true) return { type: "cursor", spot: { x: 0, y: 0, cards: true } };
      return { type: "cursor", spot: { x: unit(s.x), y: unit(s.y) } };
    }
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
