import { GAME, randomMap } from "@shooter/shared";
import { matchMaker } from "colyseus";
import type { Room } from "colyseus";
import type { AuthService } from "./auth";

export interface MatchPlayer {
  sessionId: string;
  uid: string;
  name: string;
}

export interface MatchEntry {
  players: MatchPlayer[];
  /** the room the players are currently connected to (party or queue) */
  room: Room;
}

export interface BotSeat {
  uid: string;
  team: number;
  name: string;
}

interface FillResult {
  a: MatchEntry[];
  b: MatchEntry[];
}

const BOT_NAMES = ["Viper", "Rex", "Mara", "Jinx", "Blaze", "Dust", "Kite", "Nox", "Echo", "Riggs"];

/** Pad both teams to `teamSize` with bot seats (respectively `aCount`/`bCount` humans already seated). */
export function botSeatsFor(teamSize: number, aCount: number, bCount: number): BotSeat[] {
  const bots: BotSeat[] = [];
  for (let i = aCount; i < teamSize; i++) bots.push(botSeat(0, i));
  for (let i = bCount; i < teamSize; i++) bots.push(botSeat(1, i));
  return bots;
}

function botSeat(team: number, idx: number): BotSeat {
  const name = BOT_NAMES[(Math.round(Math.random() * 1000) + idx + team * 3) % BOT_NAMES.length];
  return { uid: `bot-${Math.random().toString(36).slice(2, 8)}-${team}-${idx}`, team, name: `${name}_BOT` };
}

export class Matchmaker {
  private auth: AuthService;
  private teamSize: number;
  private entries: MatchEntry[] = [];
  private forming = false;
  private fallbackTimer: NodeJS.Timeout | null = null;

  constructor(auth: AuthService, teamSize?: number) {
    this.auth = auth;
    const env = Number(process.env.TEAM_SIZE);
    this.teamSize = teamSize ?? (Number.isInteger(env) && env > 0 ? env : GAME.defaultTeamSize);
  }

  getTeamSize(): number {
    return this.teamSize;
  }

  isQueued(room: Room): boolean {
    return this.entries.some((e) => e.room === room);
  }

  addEntry(entry: MatchEntry): void {
    if (this.isQueued(entry.room)) return;
    this.entries.push(entry);
    void this.drain(false);
    this.scheduleFallback();
  }

  removeForConnection(room: Room, sessionId: string): void {
    this.entries = this.entries.filter(
      (e) => !(e.room === room && e.players.some((p) => p.sessionId === sessionId)),
    );
  }

  private scheduleFallback(): void {
    if (this.fallbackTimer) return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      this.entries.length && void this.drain(true);
    }, Matchmaker.FALLBACK_MS);
    this.fallbackTimer.unref?.();
  }

  private usable(): MatchEntry[] {
    return this.entries.filter((e) => e.players.length > 0 && e.players.length <= this.teamSize);
  }

  private async drain(allowBots: boolean): Promise<void> {
    if (this.forming) return;
    this.forming = true;
    try {
      while (await this.tryMatch(allowBots)) {
        // keep filling matches until the queue can no longer support one
      }
    } finally {
      this.forming = false;
    }
    if (!allowBots && this.usable().length > 0) this.scheduleFallback();
  }

  private tryMatch(allowBots: boolean): Promise<boolean> {
    const usable = this.usable();

    const fill = (idx: number, aCeil: number, bCeil: number, a: MatchEntry[], b: MatchEntry[]): FillResult | null => {
      if (aCeil === 0 && bCeil === 0) return { a, b };
      if (idx >= usable.length) return null;
      const e = usable[idx];
      if (e.players.length <= aCeil) {
        const r = fill(idx + 1, aCeil - e.players.length, bCeil, [...a, e], b);
        if (r) return r;
      }
      if (e.players.length <= bCeil) {
        const r = fill(idx + 1, aCeil, bCeil - e.players.length, a, [...b, e]);
        if (r) return r;
      }
      return fill(idx + 1, aCeil, bCeil, a, b);
    };

    const paired = fill(0, this.teamSize, this.teamSize, [], []);
    if (paired) {
      return this.createMatch(paired.a, paired.b, []);
    }

    if (!allowBots) return Promise.resolve(false);
    return this.botMatch();
  }

  /** Build a human+bot match from any leftover entries (teams padded to full size). */
  private async botMatch(): Promise<boolean> {
    const usable = this.usable();
    const a: MatchEntry[] = [];
    const b: MatchEntry[] = [];
    let aCount = 0;
    let bCount = 0;
    const used: MatchEntry[] = [];

    for (const e of usable) {
      const n = e.players.length;
      if (aCount === this.teamSize && bCount === this.teamSize) break;
      if (aCount + n <= this.teamSize && (aCount <= bCount || bCount + n > this.teamSize)) {
        a.push(e);
        aCount += n;
        used.push(e);
      } else if (bCount + n <= this.teamSize) {
        b.push(e);
        bCount += n;
        used.push(e);
      } else if (aCount + n <= this.teamSize) {
        a.push(e);
        aCount += n;
        used.push(e);
      }
    }
    if (used.length === 0) return false;

    const bots = botSeatsFor(this.teamSize, aCount, bCount);
    return this.createMatch(a, b, bots);
  }

  private async createMatch(a: MatchEntry[], b: MatchEntry[], bots: BotSeat[]): Promise<boolean> {
    const seats: Record<string, { uid: string; team: number; name: string }> = {};
    for (const e of a) for (const p of e.players) seats[p.uid] = { uid: p.uid, team: 0, name: p.name };
    for (const e of b) for (const p of e.players) seats[p.uid] = { uid: p.uid, team: 1, name: p.name };

    const mapId = randomMap().id;
    const mid = Math.random().toString(36).slice(2, 10);

    try {
      const reservation = await matchMaker.create("match", { mid, mapId, seats, bots, authz: this.auth });
      const code = reservation.room.roomId;
      const used = new Set<MatchEntry>([...a, ...b]);
      for (const e of used) {
        for (const p of e.players) {
          const client = e.room.clients.find((c) => c.sessionId === p.sessionId);
          if (!client) continue;
          client.send("join_match", {
            code,
            token: this.auth.issueMatchToken(p.uid, mid),
            mapId: mapId,
          });
        }
      }
      this.entries = this.entries.filter((e) => !used.has(e));
      return true;
    } catch (err) {
      console.error("failed to create match room", err);
      return false;
    }
  }
}

export namespace Matchmaker {
  export const FALLBACK_MS = 2500;
}