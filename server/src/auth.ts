import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import jwt from "jsonwebtoken";
import type { AuthUser } from "@shooter/shared";

export interface StoredUser extends AuthUser {
  email?: string;
  passHash?: string;
  createdAt: number;
}

interface TokenPayload {
  uid: string;
  name: string;
  guest: boolean;
}

interface MatchTokenPayload {
  uid: string;
  mid: string;
}

function randomId(prefix: string, len = 16): string {
  return prefix + randomBytes(len).toString("hex").slice(0, len);
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password: string, salt: string, expected: string): boolean {
  const actual = scryptSync(password, salt, 64);
  const exp = Buffer.from(expected, "hex");
  return actual.length === exp.length && timingSafeEqual(actual, exp);
}

export class AuthError extends Error {}

export class AuthService {
  private users = new Map<string, StoredUser>();
  private readonly secret: string;
  private readonly filePath: string;

  constructor(opts: { secret?: string; filePath?: string }) {
    this.secret = opts.secret ?? process.env.JWT_SECRET ?? "dev-secret-change-me";
    this.filePath =
      opts.filePath ?? new URL("../../data/users.json", import.meta.url).pathname;
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const obj = JSON.parse(raw) as Record<string, StoredUser>;
      for (const [k, v] of Object.entries(obj)) this.users.set(k, v);
    } catch {
      // no file yet
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const obj: Record<string, StoredUser> = {};
    for (const [k, v] of this.users) obj[k] = v;
    writeFileSync(this.filePath, JSON.stringify(obj, null, 2));
  }

  private persist(user: StoredUser): void {
    this.users.set(user.id, user);
    this.save();
  }

  async guest(): Promise<StoredUser> {
    let displayName = "";
    do {
      displayName = "Guest" + Math.floor(1000 + Math.random() * 9000);
    } while ([...this.users.values()].some((u) => u.displayName === displayName));

    const user: StoredUser = {
      id: randomId("g", 14),
      displayName,
      isGuest: true,
      stats: { kills: 0, deaths: 0, wins: 0, matchesPlayed: 0 },
      createdAt: Date.now(),
    };
    this.persist(user);
    return user;
  }

  async register(emailRaw: string, password: string, displayName: string): Promise<StoredUser> {
    const email = (emailRaw ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AuthError("Invalid email");
    if (!password || password.length < 6) throw new AuthError("Password must be at least 6 characters");
    const name = (displayName ?? "").trim().slice(0, 20);
    if (!name) throw new AuthError("Display name required");

    for (const u of this.users.values()) if (u.email === email) throw new AuthError("Email already registered");

    const salt = randomBytes(16).toString("hex");
    const user: StoredUser = {
      id: randomId("u", 14),
      displayName: name,
      isGuest: false,
      email,
      passHash: hashPassword(password, salt) + "." + salt,
      stats: { kills: 0, deaths: 0, wins: 0, matchesPlayed: 0 },
      createdAt: Date.now(),
    };
    this.persist(user);
    return user;
  }

  async login(emailRaw: string, password: string): Promise<StoredUser> {
    const email = (emailRaw ?? "").trim().toLowerCase();
    const user = [...this.users.values()].find((u) => u.email === email);
    if (!user?.passHash) throw new AuthError("Invalid email or password");
    const [hash, salt] = user.passHash.split(".");
    if (!salt || !verifyPassword(password, salt, hash)) throw new AuthError("Invalid email or password");
    return user;
  }

  async upgradeToAccount(guestId: string, user: StoredUser): Promise<StoredUser> {
    const guest = await this.byId(guestId);
    if (guest?.isGuest && guest.stats) {
      user.stats = {
        kills: (user.stats?.kills ?? 0) + guest.stats.kills,
        deaths: (user.stats?.deaths ?? 0) + guest.stats.deaths,
        wins: (user.stats?.wins ?? 0) + guest.stats.wins,
        matchesPlayed: (user.stats?.matchesPlayed ?? 0) + guest.stats.matchesPlayed,
      };
    }
    return user;
  }

  async byId(id: string): Promise<StoredUser | undefined> {
    return this.users.get(id);
  }

  async fromToken(token: string): Promise<StoredUser | undefined> {
    try {
      const payload = jwt.verify(token, this.secret) as TokenPayload;
      return this.users.get(payload.uid);
    } catch {
      return undefined;
    }
  }

  issueToken(user: StoredUser): string {
    const payload: TokenPayload = { uid: user.id, name: user.displayName, guest: user.isGuest };
    return jwt.sign(payload, this.secret, { expiresIn: "30d" });
  }

  issueMatchToken(uid: string, mid: string): string {
    const payload: MatchTokenPayload = { uid, mid };
    return jwt.sign(payload, this.secret, { expiresIn: "1h" });
  }

  verifyMatchToken(token: string): MatchTokenPayload | null {
    try {
      return jwt.verify(token, this.secret) as MatchTokenPayload;
    } catch {
      return null;
    }
  }

  awardResult(uid: string, won: boolean, kills: number, deaths: number): void {
    const user = this.users.get(uid);
    if (!user) return;
    user.stats = user.stats ?? { kills: 0, deaths: 0, wins: 0, matchesPlayed: 0 };
    user.stats.kills += kills;
    user.stats.deaths += deaths;
    if (won) user.stats.wins += 1;
    user.stats.matchesPlayed += 1;
    this.save();
  }
}