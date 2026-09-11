import {
  GAME,
  PLAYER,
  WEAPONS,
  WEAPON_KEYS,
  applyMovement,
  createMoveState,
  collidersOf,
  viewDirection,
  type BoxCollider,
  type InputButtons,
  type MapConfig,
  type MoveState,
  type V3,
} from "@shooter/shared";
import { BotBrain } from "./BotBrain";

export interface SimPlayerOpts {
  id: string;
  name: string;
  team: number;
  isBot?: boolean;
}

export class SimPlayer {
  id: string;
  name: string;
  team: number;
  isBot: boolean;
  move: MoveState = createMoveState(0, 0);
  yaw = 0;
  pitch = 0;
  health: number = PLAYER.health;
  alive = true;
  weaponIndex = 0;
  ammo: number = WEAPONS[WEAPON_KEYS[0]].magSize;
  reserve: number = 120;
  reloadingUntil = 0;
  fireCooldown = 0;
  spawnIndex = 0;
  respawnAt = 0;
  kills = 0;
  deaths = 0;
  lastInputSeq = 0;

  constructor(o: SimPlayerOpts) {
    this.id = o.id;
    this.name = o.name;
    this.team = o.team;
    this.isBot = !!o.isBot;
  }
}

export interface GameInput {
  seq: number;
  yaw: number;
  pitch: number;
  fx: number;
  fz: number;
  buttons: InputButtons;
}

export type SimEvent =
  | { type: "kill"; killerId: string; victimId: string; killerName: string; victimName: string; weapon: string; headshot: boolean }
  | { type: "hit"; shooterId: string; victimId: string; damage: number; headshot: boolean; victimName: string; shooterName: string }
  | { type: "spawn"; playerId: string }
  | { type: "shot"; shooterId: string; weapon: string };

const EPS = 1e-9;

function aabbIntersect(o: V3, d: V3, box: BoxCollider, maxT: number): number {
  let tmin = 0;
  let tmax = maxT;
  for (let axis = 0; axis < 3; axis++) {
    const get = (v: V3) => (axis === 0 ? v.x : axis === 1 ? v.y : v.z);
    if (Math.abs(get(d)) < EPS) {
      if (get(o) < get(box.min) || get(o) > get(box.max)) return Infinity;
      continue;
    }
    let t1 = (get(box.min) - get(o)) / get(d);
    let t2 = (get(box.max) - get(o)) / get(d);
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin >= 0 ? tmin : Infinity;
}

function hitboxRanges(p: SimPlayer): { body: [number, number]; head: [number, number] } {
  if (p.move.crouching) {
    return { body: [0.1, 0.95], head: [0.95, 1.18] };
  }
  return { body: [0.1, 1.35], head: [1.35, 1.75] };
}

export class Simulation {
  players = new Map<string, SimPlayer>();
  private colliders: BoxCollider[];
  private map: MapConfig;
  private lastInputPerPlayer = new Map<string, GameInput>();
  private teamScores = [0, 0];
  private botBrain = new BotBrain(this);

  readonly scoreTarget = GAME.tdmScoreTarget;
  readonly timeLimitMs = GAME.matchTimeLimitSec * 1000;

  constructor(map: MapConfig, rng?: () => number) {
    this.map = map;
    this.colliders = collidersOf(map);
    this.botBrain = new BotBrain(this, rng);
  }

  addPlayer(id: string, name: string, team: number, isBot = false): SimPlayer {
    const p = new SimPlayer({ id, name, team, isBot });
    this.players.set(id, p);
    this.placeAtSpawn(p, false);
    return p;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    this.lastInputPerPlayer.delete(id);
  }

  idleInput(p: SimPlayer): GameInput {
    return {
      seq: 0,
      yaw: p.yaw,
      pitch: p.pitch,
      fx: 0,
      fz: 0,
      buttons: { fire: false, jump: false, sprint: false, crouch: false },
    };
  }

  setInput(id: string, input: GameInput): void {
    const p = this.players.get(id);
    if (!p) return;
    if (input.seq <= p.lastInputSeq) return;
    p.lastInputSeq = input.seq;
    this.lastInputPerPlayer.set(id, input);
  }

  get score(): [number, number] {
    return [...this.teamScores] as [number, number];
  }

  private placeAtSpawn(p: SimPlayer, countAsRespawn: boolean): void {
    const spawns = p.team === 0 ? this.map.spawnA : this.map.spawnB;
    const s = spawns[p.spawnIndex % spawns.length];
    p.spawnIndex += 1;
    p.move = createMoveState(s.pos.x, s.pos.z);
    p.move.y = s.pos.y;
    p.yaw = s.yaw;
    p.pitch = 0;
    p.health = PLAYER.health;
    p.alive = true;
    p.weaponIndex = 0;
    p.ammo = WEAPONS[WEAPON_KEYS[0]].magSize;
    p.reserve = 120;
    p.reloadingUntil = 0;
    p.fireCooldown = 0;
    this.lastInputPerPlayer.delete(p.id);
    if (countAsRespawn) {
      this.shots = [...this.shots, { type: "spawn", playerId: p.id }];
    }
  }

  private shots: SimEvent[] = [];

  private startReload(p: SimPlayer, now: number): void {
    const wpn = WEAPONS[WEAPON_KEYS[p.weaponIndex]];
    if (p.reserve <= 0 || p.ammo >= wpn.magSize || p.reloadingUntil > now) return;
    p.reloadingUntil = now + wpn.reloadMs;
  }

  private eyeOf(p: SimPlayer): V3 {
    const eyeH = p.move.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    return { x: p.move.x, y: p.move.y + eyeH, z: p.move.z };
  }

  setWeapon(id: string, slot: number): void {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    if (slot < 0 || slot >= WEAPON_KEYS.length) return;
    p.weaponIndex = slot;
    p.reloadingUntil = 0;
  }

  startReloadPlayer(id: string, now: number): void {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    this.startReload(p, now);
  }

  private tryFire(p: SimPlayer, now: number, allowMove: boolean): void {
    if (!p.alive) return;
    const wpn = WEAPONS[WEAPON_KEYS[p.weaponIndex]];

    if (p.reloadingUntil > 0 && now >= p.reloadingUntil) {
      p.ammo = wpn.magSize;
      p.reloadingUntil = 0;
    }

    if (p.fireCooldown > 0) p.fireCooldown -= 1000 / GAME.tickRate;

    const input = this.lastInputPerPlayer.get(p.id);
    const firing = !!input?.buttons.fire;
    if (!firing) {
      if (p.ammo <= 0 && p.reserve > 0 && p.reloadingUntil === 0) this.startReload(p, now);
      return;
    }

    if (p.fireCooldown > 0) return;

    if (p.ammo <= 0) {
      if (p.reloadingUntil === 0) this.startReload(p, now);
      return;
    }

    p.ammo -= 1;
    p.fireCooldown = wpn.fireIntervalMs;
    if (p.ammo <= 0) this.startReload(p, now);

    this.shots.push({ type: "shot", shooterId: p.id, weapon: wpn.key });

    if (!allowMove) return;

    const origin = this.eyeOf(p);
    const dir = viewDirection(input?.yaw ?? p.yaw, input?.pitch ?? p.pitch);
    let bestPlayer: { p: SimPlayer; t: number; headshot: boolean } | null = null;
    let bestT = Infinity;

    for (const other of this.players.values()) {
      if (other.team === p.team || !other.alive) continue;
      const ranges = hitboxRanges(other);
      const [h0, h1] = ranges.body;
      const [hh0, hh1] = ranges.head;
      const minV = { x: other.move.x - PLAYER.radius, y: other.move.y + h0, z: other.move.z - PLAYER.radius };
      const maxV = { x: other.move.x + PLAYER.radius, y: other.move.y + h1, z: other.move.z + PLAYER.radius };
      const tBody = aabbIntersect(origin, dir, { min: minV, max: maxV }, wpn.range);
      const minH = { x: other.move.x - PLAYER.radius, y: other.move.y + hh0, z: other.move.z - PLAYER.radius };
      const maxH = { x: other.move.x + PLAYER.radius, y: other.move.y + hh1, z: other.move.z + PLAYER.radius };
      const tHead = aabbIntersect(origin, dir, { min: minH, max: maxH }, wpn.range);
      const t = Math.min(tBody, tHead);
      if (t < bestT) {
        bestT = t;
        bestPlayer = { p: other, t, headshot: tHead <= tBody };
      }
    }

    // world geometry before hit?
    let blocked = false;
    for (const box of this.colliders) {
      const t = aabbIntersect(origin, dir, box, wpn.range);
      if (t < bestT) {
        blocked = true;
        break;
      }
    }
    if (blocked || !bestPlayer) return;

    const victim = bestPlayer.p;
    const dmg = Math.round(wpn.damage * (bestPlayer.headshot ? wpn.headshotMultiplier : 1));
    victim.health -= dmg;

    this.shots.push({
      type: "hit",
      shooterId: p.id,
      victimId: victim.id,
      damage: dmg,
      headshot: bestPlayer.headshot,
      shooterName: p.name,
      victimName: victim.name,
    });

    if (victim.health <= 0) {
      victim.alive = false;
      victim.respawnAt = now + GAME.respawnTimeMs;
      victim.deaths += 1;
      p.kills += 1;
      this.teamScores[p.team] += 1;
      this.shots.push({
        type: "kill",
        killerId: p.id,
        victimId: victim.id,
        killerName: p.name,
        victimName: victim.name,
        weapon: wpn.key,
        headshot: bestPlayer.headshot,
      });
    }
  }

  /**
   * Resolve push-out for player against box (horizontal only, no penetration).
   */
  private resolvePlayerAgainstBox(p: SimPlayer, box: BoxCollider): void {
    const r = PLAYER.radius;
    if (p.move.y >= box.max.y - 0.02) return;
    const closestX = Math.max(box.min.x, Math.min(p.move.x, box.max.x));
    const closestZ = Math.max(box.min.z, Math.min(p.move.z, box.max.z));
    let dx = p.move.x - closestX;
    let dz = p.move.z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= r * r) return;
    if (distSq === 0) {
      // fully inside the box: push out along the nearest face
      const overlX = Math.min(p.move.x - box.min.x, box.max.x - p.move.x);
      const overlZ = Math.min(p.move.z - box.min.z, box.max.z - p.move.z);
      if (overlX < overlZ) {
        p.move.x = p.move.x - box.min.x < box.max.x - p.move.x ? box.min.x - r : box.max.x + r;
      } else {
        p.move.z = p.move.z - box.min.z < box.max.z - p.move.z ? box.min.z - r : box.max.z + r;
      }
      return;
    }
    const dist = Math.sqrt(distSq);
    const push = (r - dist) / dist;
    p.move.x += dx * push;
    p.move.z += dz * push;
  }

  private clampToBounds(p: SimPlayer): void {
    const r = PLAYER.radius;
    p.move.x = Math.max(this.map.bounds.min.x + r, Math.min(p.move.x, this.map.bounds.max.x - r));
    p.move.z = Math.max(this.map.bounds.min.z + r, Math.min(p.move.z, this.map.bounds.max.z - r));
  }

  /**
   * Advance the world by one fixed tick.
   * Returns the events produced this tick (hits, kills, spawns, etc).
   */
  tick(now: number, allowControl: boolean): SimEvent[] {
    this.shots = [];
    const dt = 1 / GAME.tickRate;

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (now >= p.respawnAt) {
          this.placeAtSpawn(p, true);
        }
        continue;
      }

      const humanInput = this.lastInputPerPlayer.get(p.id);
      let input: GameInput | null = humanInput ?? null;
      if (p.isBot) {
        input = this.botBrain.think(p, now, allowControl);
        if (input) this.lastInputPerPlayer.set(p.id, input);
      }
      if (allowControl && input) {
        p.yaw = input.yaw;
        p.pitch = input.pitch;
        applyMovement(p.move, {
          yaw: input.yaw,
          fx: input.fx,
          fz: input.fz,
          jump: input.buttons.jump,
          sprint: input.buttons.sprint,
          crouch: input.buttons.crouch,
          dt,
        });
      }

      for (const box of this.colliders) this.resolvePlayerAgainstBox(p, box);
      this.clampToBounds(p);
      this.tryFire(p, now, allowControl);
    }

    return this.shots;
  }

  results(): { id: string; kills: number; deaths: number }[] {
    return [...this.players.values()].map((p) => ({ id: p.id, kills: p.kills, deaths: p.deaths }));
  }

  winnerForScore(target: number): number {
    if (this.teamScores[0] >= target) return 0;
    if (this.teamScores[1] >= target) return 1;
    return -1;
  }

  aliveCountByTeam(team: number): number {
    let n = 0;
    for (const p of this.players.values()) if (p.alive && p.team === team) n += 1;
    return n;
  }
}