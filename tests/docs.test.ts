import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { CLIENT_MESSAGE_TYPES, SERVER_MESSAGE_TYPES } from "@/core/protocol";
import { ERROR_CODES } from "@/core/room";
import { DECK } from "@/core/deck";

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

/**
 * Guards against docs drifting from code: every protocol message, error code,
 * environment variable and card must be documented where users look for it.
 */
describe("documentation is aligned with the code", () => {
  const files = ["README.md", "docs/MECHANICS.md", "docs/PROTOCOL.md", "docs/JIRA.md", ".env.example"];

  it("all documents exist", () => {
    for (const f of files) expect(existsSync(path.join(root, f)), f).toBe(true);
  });

  it("PROTOCOL.md documents every client and server message type", () => {
    const doc = read("docs/PROTOCOL.md");
    for (const t of [...CLIENT_MESSAGE_TYPES, ...SERVER_MESSAGE_TYPES]) expect(doc, `message ${t}`).toContain(`\`${t}\``);
  });

  it("PROTOCOL.md documents every error code", () => {
    const doc = read("docs/PROTOCOL.md");
    for (const c of [...ERROR_CODES, "BAD_MESSAGE", "JIRA", "INTERNAL"]) expect(doc, `error ${c}`).toContain(`\`${c}\``);
  });

  it("PROTOCOL.md documents the WebRTC transport and how a room code finds its host", () => {
    const doc = read("docs/PROTOCOL.md");
    for (const w of ["WebRTC", "PeerJS", "ppoker-", "data channel", "/room/#"]) expect(doc, w).toContain(w);
  });

  it("JIRA.md documents the local Jira helper (credentials in .env, origins, allowed endpoints)", () => {
    const doc = read("docs/JIRA.md");
    for (const w of ["CORS", "jira-helper.mjs", "--origin", "JIRA_PERSONAL_TOKEN", "/status", "127.0.0.1", "never"]) expect(doc, w).toContain(w);
  });

  it("every env var in .env.example is documented in docs/JIRA.md or the README", () => {
    const vars = [...read(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
    expect(vars.length).toBeGreaterThan(5);
    const docs = read("README.md") + read("docs/JIRA.md");
    for (const v of vars) expect(docs, v).toContain(v);
  });

  it("MECHANICS.md documents every card, both rules and the convergence formula", () => {
    const doc = read("docs/MECHANICS.md");
    for (const c of DECK) expect(doc, `card ${c}`).toContain(String(c));
    for (const w of ["unanimous", "adjacent", "modeShare", "spreadSteps", "converging", "diverging", "stalled", "agreed", "override"]) {
      expect(doc, w).toContain(w);
    }
  });

  it("README links every doc and lists the npm scripts that exist", () => {
    const readme = read("README.md");
    for (const f of ["docs/MECHANICS.md", "docs/PROTOCOL.md", "docs/JIRA.md"]) expect(readme, f).toContain(f);
    const scripts = Object.keys(JSON.parse(read("package.json")).scripts) as string[];
    for (const s of ["dev", "build", "preview", "test"]) {
      expect(scripts).toContain(s);
      expect(readme, `npm run ${s}`).toMatch(new RegExp(`npm (run )?${s}\\b`));
    }
  });
});
