import type { AuthResponse, AuthUser } from "@shooter/shared";

const env = (import.meta as any).env ?? {};
const DEV = !!env.DEV;
// In production the server serves this same origin, so target it automatically.
const SERVER = env.VITE_SERVER_URL ?? (DEV ? "http://localhost:2567" : window.location.origin);
const WS_URL =
  env.VITE_WS_URL ??
  (DEV ? "ws://localhost:2567" : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`);

import { Client as ColyseusClient } from "colyseus.js";
let _client: ColyseusClient | null = null;
export function getColyseusClient() {
  if (!_client) _client = new ColyseusClient(WS_URL);
  return _client;
}

const LS_KEY = "shooter_token";
const SS_KEY = "shooter_guest";

/** Guests live per-tab (sessionStorage) so two windows can play as different
 *  players; registered logins persist across tabs (localStorage). */
export function getStoredToken(): string | null {
  return sessionStorage.getItem(SS_KEY) ?? localStorage.getItem(LS_KEY);
}
export function setStoredToken(token: string): void {
  sessionStorage.setItem(SS_KEY, token);
}
export function persistStoredToken(token: string): void {
  localStorage.setItem(LS_KEY, token);
  sessionStorage.setItem(SS_KEY, token);
}
export function clearStoredToken(): void {
  sessionStorage.removeItem(SS_KEY);
  localStorage.removeItem(LS_KEY);
}

export async function apiFetch(
  method: string,
  path: string,
  body?: unknown,
): Promise<AuthResponse> {
  const token = getStoredToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`${SERVER}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json?.error ?? "request failed");
  return json as AuthResponse;
}

export async function apiMe(): Promise<{ user: AuthUser } | null> {
  try {
    const token = getStoredToken();
    if (!token) return null;
    const r = await fetch(`${SERVER}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return (await r.json()) as { user: AuthUser };
  } catch {
    return null;
  }
}

export async function apiGuest(): Promise<AuthResponse> {
  return apiFetch("POST", "/api/auth/guest");
}
export async function apiLogin(email: string, password: string): Promise<AuthResponse> {
  return apiFetch("POST", "/api/auth/login", { email, password });
}
export async function apiRegister(
  email: string,
  password: string,
  name: string,
): Promise<AuthResponse> {
  return apiFetch("POST", "/api/auth/register", { email, password, displayName: name });
}

/** Split a Colyseus JOIN_MATCH message into the type the client needs. */
export type JoinMatchData = { code: string; token: string; mapId: string };