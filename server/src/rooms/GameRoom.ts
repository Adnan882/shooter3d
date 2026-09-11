import { Client, Room } from "colyseus";
import {
  GAME,
  MSG,
  WEAPONS,
  getMap,
  GameRoomState,
  KillFeedItem,
  PlayerState,
  type InputMessage,
  type MatchEndMessage,
} from "@shooter/shared";
import { AuthService } from "../auth";
import { Simulation } from "../sim/Simulation";
import type { BotSeat } from "../matchmaker";

interface Seat {
  uid: string;
  team: number;
  name: string;
}

const TD = 1000 / GAME.tickRate;

export class GameRoom extends Room<GameRoomState> {
  maxClients = 20;
  private authz!: AuthService;
  private sim!: Simulation;
  private seats = new Map<string, Seat>();
  private mid = "";
  private countdownStart = 0;
  private startedAt = 0;
  private ended = false;

  onCreate(options: { mid?: string; seats?: Record<string, Seat>; bots?: BotSeat[]; authz?: AuthService; mapId?: string }) {
    this.authz = options.authz!;
    this.mid = options.mid ?? "";
    for (const [uid, seat] of Object.entries(options.seats ?? {})) {
      this.seats.set(uid, seat);
    }

    const mapId = options.mapId ?? "desert";
    const map = getMap(mapId);
    if (!map) throw new Error("unknown map: " + mapId);
    this.sim = new Simulation(map);

    this.setState(new GameRoomState());
    this.state.mapId = mapId;
    this.state.mode = "tdm";
    this.state.state = "countdown";
    this.state.countdown = GAME.countdownSec;
    this.state.scoreTarget = GAME.tdmScoreTarget;

    for (const bot of options.bots ?? []) {
      this.sim.addPlayer(bot.uid, bot.name, bot.team, true);
      const ps = new PlayerState();
      ps.id = bot.uid;
      ps.name = bot.name;
      ps.team = bot.team;
      this.state.players.set(bot.uid, ps);
    }

    this.countdownStart = Date.now();
    this.setSimulationInterval(() => this.tick(), TD);
    // NOTE: intentionally NOT locked — seat holders join via joinById while
    // onAuth rejects everyone who isn't in the seat map.

    this.onMessage(MSG.INPUT, (client, msg: InputMessage) => {
      const seat = this.seats.get(client.auth.uid);
      if (!seat) return;
      if (!Number.isFinite(msg.yaw) || !Number.isFinite(msg.pitch) || !Number.isFinite(msg.fx) || !Number.isFinite(msg.fz)) return;
      this.sim.setInput(client.auth.uid, msg);
    });

    this.onMessage(MSG.RELOAD, (client) => {
      this.sim.startReloadPlayer(client.auth.uid, Date.now());
    });

    this.onMessage(MSG.SWITCH, (client, slot: number) => {
      this.sim.setWeapon(client.auth.uid, slot);
    });
  }

  onAuth(_client: Client, options: { token?: string }): { uid: string } | false {
    if (!options?.token) return false;
    const payload = this.authz.verifyMatchToken(options.token);
    if (!payload) return false;
    if (payload.mid !== this.mid) return false;
    const seat = this.seats.get(payload.uid);
    if (!seat) return false;
    return { uid: payload.uid };
  }

  onJoin(client: Client) {
    const seat = this.seats.get(client.auth.uid)!;
    if (this.sim.players.has(seat.uid)) {
      // duplicate connection (reconnect attempt) — reject to keep things sane
      client.leave();
      return;
    }
    this.sim.addPlayer(seat.uid, seat.name, seat.team);

    const ps = new PlayerState();
    ps.id = seat.uid;
    ps.name = seat.name;
    ps.team = seat.team;
    this.state.players.set(seat.uid, ps);
  }

  onLeave(client: Client) {
    this.sim.removePlayer(client.auth.uid);
    this.state.players.delete(client.auth.uid);
    // Bots don't hold client connections, so the room is empty once every real
    // client has left (bot-only matches must still reach their natural end).
    if (this.state.state !== "finished" && this.clients.length === 0) {
      this.disconnect();
    }
  }

  private tick() {
    const now = Date.now();

    if (this.state.state === "countdown") {
      const elapsed = now - this.countdownStart;
      const remaining = Math.max(0, GAME.countdownSec - Math.floor(elapsed / 1000));
      this.state.countdown = remaining;
      if (remaining === 0) {
        this.state.state = "playing";
        this.startedAt = now;
      }
      this.sim.tick(now, false);
      this.syncAll(now);
      return;
    }

    if (this.ended) return;

    const allowControl = this.state.state === "playing";
    const events = this.sim.tick(now, allowControl);

    for (const ev of events) {
      switch (ev.type) {
        case "hit": {
          this.sendTo(this.state.players.get(ev.victimId), MSG.DAMAGED, {
            amount: ev.damage,
            headshot: ev.headshot,
            attackerId: ev.shooterId,
            attackerName: ev.shooterName,
          });
          this.sendTo(this.state.players.get(ev.shooterId), MSG.HIT, { headshot: ev.headshot });
          break;
        }
        case "kill": {
          const kf = new KillFeedItem();
          kf.killerId = ev.killerId;
          kf.killerName = ev.killerName;
          kf.victimId = ev.victimId;
          kf.victimName = ev.victimName;
          kf.weapon = ev.weapon;
          kf.headshot = ev.headshot;
          kf.at = now;
          this.state.killFeed.push(kf);
          if (this.state.killFeed.length > 12) this.state.killFeed.shift();
          break;
        }
        case "spawn": {
          this.sendTo(this.state.players.get(ev.playerId), MSG.SPAWN, {});
          break;
        }
      }
    }

    this.syncAll(now);

    const [scoreA, scoreB] = this.sim.score;
    this.state.scoreA = scoreA;
    this.state.scoreB = scoreB;
    this.state.timeLeft = Math.max(0, this.sim.timeLimitMs - (now - this.startedAt));

    let winnerTeam = this.sim.winnerForScore(this.state.scoreTarget);
    if (winnerTeam === -1 && now - this.startedAt >= this.sim.timeLimitMs) {
      winnerTeam = scoreA > scoreB ? 0 : scoreB > scoreA ? 1 : -1;
    }
    if (winnerTeam !== -1) {
      this.endMatch(winnerTeam);
    }
  }

  private endMatch(winnerTeam: number) {
    this.ended = true;
    this.state.state = "finished";
    const results = this.sim.results().map((r) => {
      const seat = this.seats.get(r.id);
      const ps = this.state.players.get(r.id);
      return {
        id: r.id,
        name: seat?.name ?? ps?.name ?? "?",
        team: ps?.team ?? 0,
        kills: r.kills,
        deaths: r.deaths,
      };
    });
    for (const r of results) {
      if (r.id.startsWith("bot-")) continue;
      this.authz.awardResult(r.id, r.team === winnerTeam, r.kills, r.deaths);
    }
    this.broadcast(MSG.MATCH_END, {
      winnerTeam,
      scoreA: this.state.scoreA,
      scoreB: this.state.scoreB,
      results,
    } satisfies MatchEndMessage);
  }

  private syncAll(now: number) {
    for (const p of this.sim.players.values()) {
      const ps = this.state.players.get(p.id);
      if (!ps) continue;
      ps.health = Math.max(0, p.health);
      ps.alive = p.alive;
      ps.x = p.move.x;
      ps.y = p.move.y;
      ps.z = p.move.z;
      ps.yaw = p.yaw;
      ps.pitch = p.pitch;
      ps.weapon = p.weaponIndex;
      ps.ammo = p.ammo;
      ps.reserve = p.reserve;
      ps.crouching = p.move.crouching;
      ps.reloading = p.reloadingUntil > now;
      ps.kills = p.kills;
      ps.deaths = p.deaths;
    }
  }

  private sendTo<T>(ps: PlayerState | undefined, message: string, data: T) {
    if (!ps) return;
    const client = this.clients.find((c) => c.auth?.uid === ps.id);
    if (client) client.send(message, data);
  }
}

export const weaponName = (key: string) => WEAPONS[key]?.name ?? key;