import type { AuthUser } from "@shooter/shared";
import {
  apiGuest,
  apiLogin,
  apiRegister,
  apiMe,
  clearStoredToken,
  getStoredToken,
  persistStoredToken,
  setStoredToken,
} from "./net";

let _user: AuthUser | null = null;
let _token = getStoredToken();

export function getUser(): AuthUser | null {
  return _user;
}
export function getToken(): string | null {
  return _token;
}

export async function ensureGuest(): Promise<AuthUser> {
  if (_user) return _user;
  if (_token) {
    const res = await apiMe();
    if (res?.user && !res.user.isGuest) {
      // registered account: persist across tabs, keep in this tab too
      setStoredToken(_token);
      _user = res.user;
      return _user;
    }
    // guest tokens were historically stored in localStorage (shared across
    // tabs), which made every window the same player and broke match join.
    // Only keep a guest identity if it already belongs to *this* tab.
    if (res?.user && sessionStorage.getItem("shooter_guest") === _token) {
      _user = res.user;
      return _user;
    }
    clearStoredToken();
    _token = null;
    _user = null;
  }
  const res = await apiGuest();
  _token = res.token;
  _user = res.user;
  setStoredToken(_token!);
  return _user;
}

export async function login(email: string, password: string) {
  const res = await apiLogin(email, password);
  _token = res.token;
  _user = res.user;
  persistStoredToken(_token!);
  return _user!;
}

export async function register(email: string, password: string, name: string) {
  const res = await apiRegister(email, password, name);
  _token = res.token;
  _user = res.user;
  persistStoredToken(_token!);
  return _user!;
}

export function logout() {
  _token = null;
  _user = null;
  clearStoredToken();
}