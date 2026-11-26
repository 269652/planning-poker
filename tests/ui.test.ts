import { describe, it, expect } from "vitest";
import type { RoomView, TicketView } from "@/core/room";
import { relativeTime } from "@/ui/format";
import { ticketQueue } from "@/ui/queue";
import { parseJiraMarkup, parseInline } from "@/ui/jiraMarkup";

const t = (id: string, status: "open" | "estimated"): TicketView => ({
  id, title: id, source: "manual", currentEstimate: null, status, estimate: status === "estimated" ? 3 : null,
  resolution: null, rounds: [], writeback: { status: "none" }, convergence: {} as TicketView["convergence"],
});
const view = (tickets: TicketView[], currentTicketId: string | null): RoomView => ({
  id: "R", name: "R", board: null, rule: "unanimous", you: "p", hostId: "p", currentTicketId, participants: [], tickets, chat: [],
});

describe("ticketQueue", () => {
  it("splits into the current ticket, the remaining open ones in order (starting after current) and done", () => {
    const q = ticketQueue(view([t("a", "open"), t("b", "estimated"), t("c", "open"), t("d", "open")], "c"));
    expect(q.current?.id).toBe("c");
    expect(q.upNext.map((x) => x.id)).toEqual(["d", "a"]);
    expect(q.done.map((x) => x.id)).toEqual(["b"]);
    expect(q.next?.id).toBe("d");
  });

  it("an estimated current ticket is shown as current, not as remaining", () => {
    const q = ticketQueue(view([t("a", "estimated"), t("b", "open")], "a"));
    expect(q.current?.id).toBe("a");
    expect(q.upNext.map((x) => x.id)).toEqual(["b"]);
    expect(q.done.map((x) => x.id)).toEqual([]);
  });

  it("without a current ticket every open one is remaining", () => {
    const q = ticketQueue(view([t("a", "open"), t("b", "open")], null));
    expect(q.current).toBeNull();
    expect(q.upNext.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000;
  it("formats recent and older times", () => {
    expect(relativeTime(now - 20_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2 days ago");
  });
});

describe("parseJiraMarkup (Jira wiki markup → safe blocks)", () => {
  it("parses headings, paragraphs, bullet and numbered lists", () => {
    expect(parseJiraMarkup("h2. Goal\nUsers can log in.\nWith SSO.\n\n* one\n* two\n# first\n# second")).toEqual([
      { kind: "heading", level: 2, text: "Goal" },
      { kind: "paragraph", text: "Users can log in.\nWith SSO." },
      { kind: "list", ordered: false, items: ["one", "two"] },
      { kind: "list", ordered: true, items: ["first", "second"] },
    ]);
  });

  it("parses code/noformat blocks verbatim and quotes", () => {
    expect(parseJiraMarkup("{code:java}\nint *x* = 1;\n{code}\n{noformat}raw{noformat}\nbq. quoted")).toEqual([
      { kind: "code", text: "int *x* = 1;" },
      { kind: "code", text: "raw" },
      { kind: "quote", text: "quoted" },
    ]);
  });

  it("parses tables with header rows", () => {
    expect(parseJiraMarkup("||Field||Value||\n|a|b|")).toEqual([
      { kind: "table", rows: [{ header: true, cells: ["Field", "Value"] }, { header: false, cells: ["a", "b"] }] },
    ]);
  });

  it("parses Markdown-ish descriptions too (Cloud / pasted text)", () => {
    expect(parseJiraMarkup("## AC\n- one\n- two\n1. x")).toEqual([
      { kind: "heading", level: 2, text: "AC" },
      { kind: "list", ordered: false, items: ["one", "two"] },
      { kind: "list", ordered: true, items: ["x"] },
    ]);
  });

  it("parses inline bold, italic, code and links; only http(s) links become links", () => {
    expect(parseInline("*bold* and _it_ {{x()}} [Docs|https://d.example] [bad|javascript:alert(1)] https://a.example/p")).toEqual([
      { kind: "strong", text: "bold" }, { kind: "text", text: " and " }, { kind: "em", text: "it" }, { kind: "text", text: " " },
      { kind: "code", text: "x()" }, { kind: "text", text: " " }, { kind: "link", text: "Docs", href: "https://d.example" },
      { kind: "text", text: " bad " }, { kind: "link", text: "https://a.example/p", href: "https://a.example/p" },
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseJiraMarkup("  \n ")).toEqual([]);
  });
});
