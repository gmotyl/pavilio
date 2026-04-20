import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
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
    state = JSON.parse(raw);
    return;
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
