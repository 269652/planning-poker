"use client";
import { useEffect, useState } from "react";
import { DEFAULT_HELPER_URL, helperCommand, type HelperStatus } from "@/jira/helper";
import { BASE_PATH } from "@/ui/site";

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-line">
      <code>{text}</code>
      <button type="button" className="small" onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt("Copy", text); }
      }}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

/** Explains and shows the state of the host's local Jira helper. */
export default function HelperPanel({ status, onRetry, helperUrl, onHelperUrl }: {
  status: HelperStatus; onRetry: () => void; helperUrl: string; onHelperUrl?: (url: string) => void;
}) {
  const [origin, setOrigin] = useState("https://<this site>");
  const [url, setUrl] = useState(helperUrl);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => { setUrl(helperUrl); }, [helperUrl]);

  if (status.state === "connected") {
    let host = status.jiraUrl;
    try { host = new URL(status.jiraUrl).host; } catch { /* keep */ }
    return (
      <div className="helper ok" role="status">
        <b>✓ Jira helper connected</b> — signed in to {host} as <b>{status.user}</b>. You can host rooms.
      </div>
    );
  }

  return (
    <div className={`helper ${status.state === "checking" ? "" : "warn"}`} role="status">
      {status.state === "checking" && <p><b>Looking for the Jira helper on this computer…</b></p>}
      {status.state === "jira-error" && (
        <p><b>⚠ The Jira helper is running but cannot sign in to Jira.</b><br /><span className="small">{status.error} Fix the <code>JIRA_*</code> values in its <code>.env</code> and restart it.</span></p>
      )}
      {status.state === "offline" && (
        <>
          <p><b>The Jira helper is not running on this computer.</b>{status.error && <><br /><span className="small error">{status.error}</span></>}</p>
          <ol className="steps small">
            <li>
              Download <a href={`${BASE_PATH}/jira-helper.mjs`} download>jira-helper.mjs</a> (needs Node.js 18+),
              or use <code>npm run jira-helper -- --origin {origin}</code> in a clone of the repository.
            </li>
            <li>
              Put a <code>.env</code> file next to it with your Jira credentials — they stay on your computer:
              <pre>{`JIRA_BASE_URL=https://jira.example.com
JIRA_API_TOKEN=<api token or personal access token>
JIRA_AUTH=bearer          # personal access token (Server/DC)
# JIRA_EMAIL=you@example.com   # instead of bearer: Jira Cloud`}</pre>
            </li>
            <li>Start it, allowing this site:<CopyLine text={helperCommand(origin)} /></li>
            <li>This page connects automatically. If your browser asks to allow access to devices on your local network, allow it.</li>
          </ol>
        </>
      )}
      <div className="row">
        <button type="button" className="small" onClick={onRetry} disabled={status.state === "checking"}>Check again</button>
        {onHelperUrl && (
          <details className="small grow">
            <summary>Helper address</summary>
            <form className="row" onSubmit={(e) => { e.preventDefault(); onHelperUrl(url.trim() || DEFAULT_HELPER_URL); }}>
              <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_HELPER_URL} aria-label="Helper address" />
              <button className="small">Use</button>
            </form>
          </details>
        )}
      </div>
    </div>
  );
}
