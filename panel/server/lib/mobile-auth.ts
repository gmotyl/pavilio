import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

interface AuthState {
  signingKey: string; // base64url
  generation: number;
  token: string | null;
}

let state: AuthState | null = null;

function stateDir(): string {
  return process.env.PANEL_AUTH_STATE_DIR ?? join(homedir(), ".panel");
}
function stateFile(): string {
  return join(stateDir(), "mobile-auth-state.json");
}

export async function loadAuthState(): Promise<void> {
  const dir = stateDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const file = stateFile();
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8");
    try {
      state = JSON.parse(raw);
      return;
    } catch (e) {
      console.warn(
        `[mobile-auth] state file at ${file} is invalid JSON, regenerating: ${(e as Error).message}`,
      );
      // fall through to fresh-state init
    }
  }
  state = {
    signingKey: randomBytes(32).toString("base64url"),
    generation: 0,
    token: null,
  };
  persist();
}

function persist(): void {
  if (!state) return;
  const file = stateFile();
  writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

function requireState(): AuthState {
  if (!state) throw new Error("mobile-auth: loadAuthState() not called yet");
  return state;
}

export async function rotateToken(): Promise<string> {
  const s = requireState();
  s.generation += 1;
  s.token = randomBytes(32).toString("base64url");
  persist();
  return s.token;
}

/**
 * Return the current token if one exists, otherwise mint a fresh one.
 * Used by enable() so toggling mobile access on/off reuses the same
 * pairing token — the token only rotates when the user explicitly
 * asks to rotate it.
 */
export async function ensureToken(): Promise<string> {
  const s = requireState();
  if (s.token) return s.token;
  return rotateToken();
}

export async function clearToken(): Promise<void> {
  const s = requireState();
  s.generation += 1;
  s.token = null;
  persist();
}

export function getCurrentToken(): string | null {
  return requireState().token;
}

export function getCurrentGeneration(): number {
  return requireState().generation;
}

const COOKIE_NAME = "mobile_session";

function sign(generation: number): string {
  const s = requireState();
  const genPart = Buffer.from(String(generation)).toString("base64url");
  const mac = createHmac("sha256", Buffer.from(s.signingKey, "base64url"))
    .update(genPart)
    .digest("base64url");
  return `${genPart}.${mac}`;
}

export function verifyLoginToken(submitted: string): boolean {
  const s = requireState();
  if (!s.token || !submitted) return false;
  const a = Buffer.from(s.token);
  const b = Buffer.from(submitted);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// 30 days, matches the `panel_token` cookie. Without an explicit lifetime
// the cookie is treated as a session cookie — iOS Safari purges those when
// the WebKit process is evicted (background, memory pressure, sleep), so
// paired phones lose their cookie within hours and hit the PairingGate
// even though `generation` hasn't changed. Manual `/rotate` still bumps
// `generation`, which invalidates outstanding cookies regardless of maxAge.
const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function issueSessionCookie(res: Response): void {
  const s = requireState();
  const value = sign(s.generation);
  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function verifySessionCookie(req: Request): boolean {
  const s = requireState();
  const raw = parseCookie(req.headers.cookie as string | undefined, COOKIE_NAME);
  if (!raw) return false;
  const [genPart, mac] = raw.split(".");
  if (!genPart || !mac) return false;
  const expected = sign(s.generation);
  const a = Buffer.from(expected);
  const b = Buffer.from(raw);
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  const decoded = Number(Buffer.from(genPart, "base64url").toString());
  return decoded === s.generation;
}
