import { describe, it, expect } from "vitest";
import { CHAT_HISTORY, CHAT_MAX_LENGTH, Room, RoomError } from "@/core/room";
import { MAX_IMAGE_CHARS, parseClientMessage, type ServerMessage } from "@/core/protocol";
import { unreadCount } from "@/ui/chat";
import { mentionedKeys, parseInline, parseMarkdown } from "@/ui/markdown";
import { highlightHTML } from "@/ui/highlight";
import { activeMention, ticketSuggestions } from "@/ui/mentions";

function setup() {
  let t = 1_000;
  let n = 0;
  const room = Room.create({ id: "ABCD2345", name: "Chat", now: () => t, newId: () => `id${++n}` });
  const host = room.join({ name: "Host" }).participant.id;
  const bob = room.join({ name: "Bob", role: "observer" }).participant.id;
  return { room, host, bob, tick: (ms: number) => { t += ms; } };
}

describe("room chat", () => {
  it("anyone, observers included, can post; everyone sees it, oldest first", () => {
    const { room, host, bob, tick } = setup();
    room.chat(host, "  hello  ");
    tick(10);
    room.chat(bob, "hi!\nsecond line");
    const chat = room.view(bob).chat;
    expect(chat.map((m) => [m.name, m.text])).toEqual([["Host", "hello"], ["Bob", "hi!\nsecond line"]]);
    expect(room.view(host).chat).toEqual(chat);
    expect(chat[1].authorId).toBe(bob);
  });

  it("rejects empty and over-long messages and unknown participants", () => {
    const { room, host } = setup();
    expect(() => room.chat(host, "   ")).toThrow(RoomError);
    expect(() => room.chat(host, "x".repeat(CHAT_MAX_LENGTH + 1))).toThrow(/at most/);
    expect(() => room.chat("nobody", "hi")).toThrow(RoomError);
  });

  it("rate-limits bursts per sender", () => {
    const { room, host, bob, tick } = setup();
    for (let i = 0; i < 5; i++) room.chat(host, `m${i}`);
    expect(() => room.chat(host, "one too many")).toThrow(expect.objectContaining({ code: "RATE_LIMITED" }));
    room.chat(bob, "others are unaffected");
    tick(5_001);
    room.chat(host, "fine again");
  });

  it("keeps only the latest messages, and survives snapshot/restore", () => {
    const { room, host, tick } = setup();
    for (let i = 0; i < CHAT_HISTORY + 7; i++) { room.chat(host, `m${i}`); tick(2_000); }
    const chat = room.view(host).chat;
    expect(chat).toHaveLength(CHAT_HISTORY);
    expect(chat[0].text).toBe("m7");
    expect(Room.restore(room.snapshot()).view(host).chat).toEqual(chat);
  });

  it("rooms saved before chat existed show an empty chat", () => {
    const { room, host } = setup();
    const { chat: _c, ...old } = room.snapshot();
    expect(Room.restore(old).view(host).chat).toEqual([]);
  });
});

describe("chat protocol", () => {
  it("parses and validates chat messages", () => {
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: " hey " }))).toEqual({ type: "chat", text: "hey" });
    expect(() => parseClientMessage(JSON.stringify({ type: "chat", text: "" }))).toThrow();
    expect(() => parseClientMessage(JSON.stringify({ type: "chat" }))).toThrow();
    expect(() => parseClientMessage(JSON.stringify({ type: "chat", text: "x".repeat(CHAT_MAX_LENGTH + 1) }))).toThrow();
  });
});

describe("chat images", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";

  it("accepts a raster data URL (with or without text) and rejects anything else", () => {
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "", image: png }))).toEqual({ type: "chat", text: "", image: png });
    expect(parseClientMessage(JSON.stringify({ type: "chat", image: png }))).toEqual({ type: "chat", text: "", image: png });
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "look", image: png }))).toEqual({ type: "chat", text: "look", image: png });
    for (const bad of ["data:image/svg+xml;base64,PHN2Zz4=", "https://example.com/x.png", "data:image/png,<script>", 42,
      `data:image/png;base64,${"A".repeat(MAX_IMAGE_CHARS)}`]) {
      expect(() => parseClientMessage(JSON.stringify({ type: "chat", text: "", image: bad })), String(bad).slice(0, 30)).toThrow();
    }
  });

  it("the host sends an image once to everyone, keeps it for late joiners, and drops the oldest", async () => {
    const { HostEngine, MAX_IMAGES } = await import("@/host/engine");
    const room = Room.create({ id: "ABCD2345", name: "Img" });
    const engine = new HostEngine({ room, jira: null });
    const inbox: { a: ServerMessage[]; b: ServerMessage[] } = { a: [], b: [] };
    const a = engine.connect((m) => inbox.a.push(m));
    await a.receive(JSON.stringify({ type: "join", roomId: "ABCD2345", name: "A" }));
    for (let i = 0; i < MAX_IMAGES + 2; i++) {
      (room as unknown as { chatTimes: Map<string, number[]> }).chatTimes.clear(); // not testing the rate limit here
      await a.receive(JSON.stringify({ type: "chat", text: `#${i}`, image: png }));
    }
    const images = inbox.a.filter((m) => m.type === "image");
    expect(images).toHaveLength(MAX_IMAGES + 2);
    const state = inbox.a.filter((m) => m.type === "state").at(-1) as Extract<ServerMessage, { type: "state" }>;
    expect(JSON.stringify(state)).not.toContain("base64"); // states only refer to images
    expect(state.room.chat.at(-1)!.imageId).toBe((images.at(-1) as { id: string }).id);

    const b = engine.connect((m) => inbox.b.push(m));
    await b.receive(JSON.stringify({ type: "join", roomId: "ABCD2345", name: "B" }));
    const late = inbox.b.filter((m) => m.type === "image").map((m) => (m as { id: string }).id);
    expect(late).toEqual(images.slice(2).map((m) => (m as { id: string }).id));
  });
});

describe("chat reactions", () => {
  it("toggles a participant's reaction and shows who reacted", () => {
    const { room, host, bob } = setup();
    const msg = room.chat(host, "ship it?");
    room.react(bob, msg.id, "👍");
    room.react(host, msg.id, "👍");
    room.react(host, msg.id, "🎉");
    expect(room.view(bob).chat[0].reactions).toEqual({ "👍": [bob, host], "🎉": [host] });
    room.react(host, msg.id, "🎉");
    expect(room.view(bob).chat[0].reactions).toEqual({ "👍": [bob, host] });
  });

  it("rejects unknown emoji and messages", () => {
    const { room, host } = setup();
    const msg = room.chat(host, "x");
    expect(() => room.react(host, msg.id, "💩")).toThrow(/Unknown reaction/);
    expect(() => room.react(host, "nope", "👍")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(parseClientMessage(JSON.stringify({ type: "react", messageId: "m1", emoji: "👍" }))).toEqual({ type: "react", messageId: "m1", emoji: "👍" });
    expect(() => parseClientMessage(JSON.stringify({ type: "react", messageId: "m1" }))).toThrow();
  });
});

describe("chat markdown", () => {
  it("parses inline formatting, links, code and issue keys", () => {
    expect(parseInline("**Bold** and *it* ~~no~~ `a*b*` see BMG-12, https://x.io/a. [Jira](https://j.io/browse/BMG-1)")).toEqual([
      { t: "b", c: [{ t: "text", v: "Bold" }] }, { t: "text", v: " and " }, { t: "i", c: [{ t: "text", v: "it" }] }, { t: "text", v: " " },
      { t: "s", c: [{ t: "text", v: "no" }] }, { t: "text", v: " " }, { t: "code", v: "a*b*" }, { t: "text", v: " see " },
      { t: "ticket", key: "BMG-12" }, { t: "text", v: ", " }, { t: "link", href: "https://x.io/a", c: [{ t: "text", v: "https://x.io/a" }] },
      { t: "text", v: ". " }, { t: "link", href: "https://j.io/browse/BMG-1", c: [{ t: "text", v: "Jira" }] },
    ]);
  });

  it("never produces links for non-http schemes, and keeps snake_case words plain", () => {
    const nodes = parseInline("[x](javascript:alert(1)) snake_case_word");
    expect(nodes.every((n) => n.t === "text")).toBe(true);
  });

  it("parses blocks: code fences, quotes, lists, headings, line breaks", () => {
    expect(parseMarkdown("# Title\nline one\nline two\n\n> quoted\n- a\n- b\n1. one\n```\nx = 1\n```").map((b) => b.t))
      .toEqual(["h", "p", "quote", "ul", "ol", "pre"]);
    expect(parseMarkdown("a\nb")[0]).toEqual({ t: "p", c: [{ t: "text", v: "a" }, { t: "br" }, { t: "text", v: "b" }] });
    expect(parseMarkdown("```\nnot **bold**\n```")[0]).toEqual({ t: "pre", v: "not **bold**" });
  });

  it("finds mentioned issue keys", () => {
    expect(mentionedKeys("BMG-1 and ABC-22, again BMG-1; not abc-1 or X-1")).toEqual(["BMG-1", "ABC-22"]);
  });
});

describe("composer highlighting", () => {
  const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");

  it("keeps every character (so the caret maps 1:1) while styling it", () => {
    const text = "**bold** _it_ `x<y>` BMG-7 [a](https://b.io)\n> q\n- li\n```\n<b>\n```\nplain & done";
    const html = highlightHTML(text);
    expect(strip(html)).toBe(text);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<span class="mention">BMG-7</span>');
    expect(html).not.toContain("<b>"); // typed markup is escaped
  });
});

describe("@ ticket mentions", () => {
  const t = (id: string, key: string, title: string, status: "open" | "estimated" = "open") =>
    ({ id, key, title, status, estimate: status === "estimated" ? 5 : null }) as never;
  const tickets = [t("1", "BMG-101", "Login page"), t("2", "BMG-20", "Search results", "estimated"), t("3", "API-7", "Login rate limit"), t("4", "BMG-3", "Logout")];

  it("detects an @query right before the caret, only at a word start", () => {
    expect(activeMention("see @bm", 7)).toEqual({ start: 4, query: "bm" });
    expect(activeMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMention("mail me@x", 9)).toBeNull();
    expect(activeMention("@bmg done", 9)).toBeNull();
  });

  it("ranks the current and open tickets first, key prefixes over title matches", () => {
    expect(ticketSuggestions(tickets, "", "3").map((s) => s.key)[0]).toBe("API-7");
    expect(ticketSuggestions(tickets, "login", null).map((s) => s.key)).toEqual(["BMG-101", "API-7"]);
    // "bmg-2" is itself a complete key (not in the session), so it is offered after the match.
    expect(ticketSuggestions(tickets, "bmg-2", null).map((s) => s.key)).toEqual(["BMG-20", "BMG-2"]);
    expect(ticketSuggestions(tickets, "bmg", null).at(-1)!.key).toBe("BMG-20"); // estimated ranks last
  });

  it("offers a complete key that isn't in the session", () => {
    expect(ticketSuggestions(tickets, "xyz-42", null)).toEqual([{ key: "XYZ-42", title: "Mention this Jira issue", hint: "not in this session" }]);
    expect(ticketSuggestions(tickets, "nothing", null)).toEqual([]);
  });
});

describe("chat helpers", () => {

  it("counts unread messages from others after the last look", () => {
    const chat = [
      { id: "1", authorId: "a", name: "A", text: "x", at: 10 },
      { id: "2", authorId: "me", name: "Me", text: "y", at: 20 },
      { id: "3", authorId: "b", name: "B", text: "z", at: 30 },
    ];
    expect(unreadCount(chat, "me", 0)).toBe(2);
    expect(unreadCount(chat, "me", 10)).toBe(1);
    expect(unreadCount(chat, "me", 30)).toBe(0);
  });
});
