import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { listMcpServers, resolveClaudeBin } from "./mcp";

/**
 * Driving `claude mcp login` from a web page.
 *
 * The CLI's login is a two-way conversation: with `--no-browser` it prints an
 * authorization URL, then blocks waiting for the redirect URL to be pasted
 * back. That does not fit one HTTP request, so the child process is held
 * between two — `begin` starts it and returns the URL, `complete` writes the
 * redirect back to its stdin.
 *
 * Holding a process across requests means it can be abandoned, so every pending
 * login carries a hard deadline and is killed when it expires. A half-finished
 * OAuth flow is harmless; a forgotten child process is not.
 */

interface PendingLogin {
  name: string;
  child: ChildProcessWithoutNullStreams;
  authUrl: string;
  output: string;
  startedAt: number;
  timer: NodeJS.Timeout;
}

/** How long a started login may sit unfinished before it is killed. */
const PENDING_TTL_MS = 5 * 60 * 1000;
/** How long to wait for the CLI to print its authorization URL. */
const URL_TIMEOUT_MS = 30_000;
/** How long to wait for the CLI to finish after the redirect is pasted. */
const COMPLETE_TIMEOUT_MS = 60_000;

const URL_PATTERN = /https?:\/\/[^\s'"]+/;

const pending = new Map<string, PendingLogin>();

export class LoginError extends Error {}

function discard(name: string): void {
  const entry = pending.get(name);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.child.kill("SIGTERM");
  pending.delete(name);
}

export function cancelLogin(name: string): boolean {
  const existed = pending.has(name);
  discard(name);
  return existed;
}

export function pendingLoginNames(): string[] {
  return [...pending.keys()];
}

/**
 * Start a login and return the URL the user must open.
 *
 * The name is validated against the CLI's own list before being passed as an
 * argument, so this can never be used to launch an arbitrary process.
 */
export async function beginLogin(name: string): Promise<{ authUrl: string; expiresInMs: number }> {
  const servers = await listMcpServers();
  if (!servers.some((s) => s.name === name)) {
    throw new LoginError(`No MCP server named "${name}".`);
  }

  // Restarting is the sane response to a second click; the old flow's URL is
  // already stale from the user's point of view.
  discard(name);

  const child = spawn(resolveClaudeBin(), ["mcp", "login", name, "--no-browser"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;

    const urlTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new LoginError(`The CLI did not print an authorization URL within ${URL_TIMEOUT_MS / 1000}s.`));
    }, URL_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      if (settled) return;
      output += chunk.toString();
      const match = output.match(URL_PATTERN);
      if (!match) return;

      settled = true;
      clearTimeout(urlTimer);

      const timer = setTimeout(() => discard(name), PENDING_TTL_MS);
      // Unref so an abandoned login can never hold the process open.
      timer.unref?.();
      pending.set(name, { name, child, authUrl: match[0], output, startedAt: Date.now(), timer });

      resolve({ authUrl: match[0], expiresInMs: PENDING_TTL_MS });
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(urlTimer);
      reject(
        new LoginError(
          (err as NodeJS.ErrnoException).code === "ENOENT"
            ? "The `claude` CLI is not on PATH for this service."
            : err.message
        )
      );
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(urlTimer);
      reject(new LoginError(output.trim() || `The CLI exited with code ${code} before printing a URL.`));
    });
  });
}

/** Paste the redirect URL back to the waiting CLI and wait for it to finish. */
export async function completeLogin(name: string, redirectUrl: string): Promise<string> {
  const entry = pending.get(name);
  if (!entry) {
    throw new LoginError("That login is no longer pending — start it again.");
  }
  if (!URL_PATTERN.test(redirectUrl)) {
    throw new LoginError("That does not look like a redirect URL.");
  }

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(entry.timer);
      clearTimeout(timeout);
      pending.delete(name);
      fn();
    };

    const timeout = setTimeout(() => {
      entry.child.kill("SIGTERM");
      finish(() => reject(new LoginError("The CLI did not finish in time after the redirect was submitted.")));
    }, COMPLETE_TIMEOUT_MS);

    entry.child.stdout.on("data", (c: Buffer) => (output += c.toString()));
    entry.child.stderr.on("data", (c: Buffer) => (output += c.toString()));

    entry.child.on("exit", (code) => {
      finish(() =>
        code === 0
          ? resolve(output.trim() || "Authenticated.")
          : reject(new LoginError(output.trim() || `The CLI exited with code ${code}.`))
      );
    });

    entry.child.on("error", (err) => finish(() => reject(new LoginError(err.message))));

    // The CLI reads the pasted URL from stdin as a single line.
    entry.child.stdin.write(`${redirectUrl.trim()}\n`);
  });
}
