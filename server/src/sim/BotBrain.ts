import { PLAYER, WEAPONS, WEAPON_KEYS } from "@shooter/shared";
import type { Simulation, SimPlayer, GameInput } from "./Simulation";

const DT = 1 / 30;

const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

type BehaviorState = "hunting" | "retreating" | "repositioning" | "strafing" | "fleeing";

interface BotMemory {
  targetId: string | null;
  strafe: number;
  strafeDir: number;
  aimAt: number;
  decideAt: number;
  preferDistance: number;
  lastHealth: number;
  state: BehaviorState;
  stateUntil: number;
  burstEnd: number;
  burstCooldown: number;
  crouchToggle: number;
  lastKillAt: number;
  jumpCooldown: number;
  strafePattern: number[];
  strafeIdx: number;
  peekDir: number;
  peekPhase: "in" | "out";
  peekUntil: number;
  suppressUntil: number;
}

/**
 * Drives bot-controlled SimPlayers with human-like behavior:
 * - Health-aware retreat and repositioning
 * - Weapon switching when empty mid-fight
 * - A-D strafing with counter-strafe stops
 * - Crouch spam during gunfights
 * - Burst fire that varies with range
 * - Peek shooting from cover positions
 * - Sprint repositioning after kills
 * - Outnumbered retreat logic
 */
export class BotBrain {
  private mem = new Map<string, BotMemory>();

  constructor(private sim: Simulation, private rng: () => number = Math.random) {}

  private getMemory(p: SimPlayer, now: number): BotMemory {
    let m = this.mem.get(p.id);
    if (!m) {
      m = this.createMemory(now);
      this.mem.set(p.id, m);
    }
    return m;
  }

  private createMemory(now: number): BotMemory {
    const pattern: number[] = [];
    const patternLen = 3 + Math.floor(this.rng() * 4);
    for (let i = 0; i < patternLen; i++) {
      pattern.push((this.rng() - 0.5) * 2);
    }
    return {
      targetId: null,
      strafe: 0,
      strafeDir: this.rng() - 0.5,
      aimAt: now + 300 + this.rng() * 800,
      decideAt: 0,
      preferDistance: 14 + this.rng() * 14,
      lastHealth: PLAYER.health,
      state: "hunting",
      stateUntil: 0,
      burstEnd: 0,
      burstCooldown: 0,
      crouchToggle: 0,
      lastKillAt: 0,
      jumpCooldown: 0,
      strafePattern: pattern,
      strafeIdx: 0,
      peekDir: this.rng() > 0.5 ? 1 : -1,
      peekPhase: "in",
      peekUntil: 0,
      suppressUntil: 0,
    };
  }

  private enemiesInRange(p: SimPlayer, range: number): SimPlayer[] {
    const result: SimPlayer[] = [];
    for (const other of this.sim.players.values()) {
      if (other.team === p.team || !other.alive) continue;
      const d = Math.hypot(other.move.x - p.move.x, other.move.z - p.move.z);
      if (d <= range) result.push(other);
    }
    return result;
  }



  think(p: SimPlayer, now: number, allowControl: boolean): GameInput | null {
    if (!allowControl || !p.alive) return null;

    const m = this.getMemory(p, now);
    const wpn = WEAPONS[WEAPON_KEYS[p.weaponIndex]];
    const hpRatio = p.health / PLAYER.health;

    // --- Track damage taken ---
    if (p.health < m.lastHealth) {
      // was hit, consider reacting
      if (p.health < PLAYER.health * 0.3 && m.state === "hunting") {
        m.state = "retreating";
        m.stateUntil = now + 800 + this.rng() * 600;
      }
    }
    m.lastHealth = p.health;

    // --- State transitions ---
    if (now >= m.stateUntil) {
      if (m.state === "retreating") {
        m.state = "repositioning";
        m.stateUntil = now + 1200 + this.rng() * 800;
        m.preferDistance = 18 + this.rng() * 12;
      } else if (m.state === "repositioning") {
        m.state = "hunting";
        m.stateUntil = now + 2000 + this.rng() * 1500;
        m.preferDistance = 12 + this.rng() * 18;
      } else if (m.state === "fleeing") {
        m.state = "repositioning";
        m.stateUntil = now + 1500 + this.rng() * 1000;
      } else if (m.state === "strafing") {
        m.state = "hunting";
        m.stateUntil = now + 1500 + this.rng() * 1000;
      }
    }

    // --- Target acquisition (more human: checks threat level, not just nearest) ---
    if (now >= m.decideAt) {
      m.decideAt = now + 200 + this.rng() * 300;

      // Count visible enemies nearby
      const nearbyEnemies = this.enemiesInRange(p, 40);

      // Outnumbered? Consider fleeing
      let allyCount = 0;
      for (const other of this.sim.players.values()) {
        if (other.team === p.team && other.alive && other.id !== p.id) {
          const d = Math.hypot(other.move.x - p.move.x, other.move.z - p.move.z);
          if (d < 30) allyCount++;
        }
      }
      if (nearbyEnemies.length > allyCount + 1 && hpRatio < 0.5 && m.state === "hunting") {
        m.state = "fleeing";
        m.stateUntil = now + 1500 + this.rng() * 1000;
      }

      // Pick target: prefer closest, but if very low HP, pick farthest (flee)
      let best: SimPlayer | null = null;
      let bestScore = -Infinity;
      for (const other of nearbyEnemies) {
        const d = Math.hypot(other.move.x - p.move.x, other.move.z - p.move.z);
        // Score: closer is better, but penalize if low HP
        let score = 100 - d;
        if (hpRatio < 0.3) score -= 30; // low HP: prefer disengaging
        if (d < 8) score += 15; // close range: high priority
        if (other.weaponIndex === 1) score += 5; // pistol = likely close range
        if (score > bestScore) {
          bestScore = score;
          best = other;
        }
      }

      if (m.state === "fleeing" || m.state === "retreating") {
        best = null; // don't pick a target while retreating
      }

      if (best?.id !== m.targetId) {
        m.targetId = best?.id ?? null;
        m.aimAt = now + 180 + this.rng() * 600; // human reaction time
      }

      // Strafe pattern cycling
      m.strafeIdx = (m.strafeIdx + 1) % m.strafePattern.length;
      m.strafe = m.strafePattern[m.strafeIdx];
    }

    // --- No target: patrol / idle ---
    const target = m.targetId ? this.sim.players.get(m.targetId) : undefined;
    if (!target || !target.alive) {
      m.targetId = null;
      // If repositioning, keep moving
      if (m.state === "repositioning" || m.state === "fleeing") {
        const fleeAngle = m.state === "fleeing" ? p.yaw + Math.PI : p.yaw + (this.rng() - 0.5) * 1.5;
        return {
          seq: 0,
          yaw: p.yaw,
          pitch: p.pitch,
          fx: Math.sin(fleeAngle),
          fz: Math.cos(fleeAngle),
          buttons: { fire: false, jump: false, sprint: true, crouch: false },
        };
      }
      return this.sim.idleInput(p);
    }

    // --- Aim at target ---
    const dx = target.move.x - p.move.x;
    const dz = target.move.z - p.move.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return this.sim.idleInput(p);

    const pEye = p.move.y + (p.move.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight);
    const tEye = target.move.y + (target.move.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight);
    const desiredYaw = Math.atan2(dx, dz);
    const aimNoise = (this.rng() - 0.5) * (dist > 20 ? 0.22 : 0.12);
    const desiredPitch = Math.atan2(tEye - pEye + aimNoise, dist);

    const yawErr = wrapAngle(desiredYaw - p.yaw);
    const pitchErr = wrapAngle(desiredPitch - p.pitch);
    const facingTarget = Math.abs(yawErr) < 0.12 && Math.abs(pitchErr) < 0.1;
    const wellAimed = Math.abs(yawErr) < 0.05 && Math.abs(pitchErr) < 0.06;

    // Turn rate: snap to target fast, then slow down to track
    const turnRate = facingTarget ? 1.8 : 5.0;
    p.yaw += Math.max(-turnRate * DT, Math.min(turnRate * DT, yawErr));
    p.pitch += Math.max(-3.5 * DT, Math.min(3.5 * DT, pitchErr));

    // --- Weapon switching: swap to pistol when rifle empty mid-fight ---
    if (p.weaponIndex === 0 && p.ammo <= 0 && p.reloadingUntil === 0 && dist < wpn.range * 0.8) {
      // In a fight and rifle is empty — quick switch to pistol
      this.sim.setWeapon(p.id, 1);
    }

    // --- Movement based on behavior state ---
    let fz = 0;
    let fx = m.strafe;

    switch (m.state) {
      case "fleeing": {
        // Run away from enemy
        const fleeFx = -Math.sin(desiredYaw);
        const fleeFz = -Math.cos(desiredYaw);
        fx = fleeFx + (this.rng() - 0.5) * 0.4;
        fz = fleeFz;
        break;
      }
      case "retreating": {
        // Back off while keeping aim on target
        fz = -0.6;
        fx = m.strafe * 0.6;
        break;
      }
      case "repositioning": {
        // Sprint to a new position, not firing
        fz = 0.8;
        fx = m.strafe * 0.3;
        break;
      }
      case "strafing": {
        // Aggressive A-D strafe, stop to shoot
        fz = 0.05;
        fx = m.strafe * 1.2;
        break;
      }
      default: {
        // Hunting: approach, strafe, hold distance
        if (dist > m.preferDistance) {
          fz = 0.85;
          fx = m.strafe * 0.35;
        } else if (dist < 5) {
          fz = -0.4;
          fx = m.strafe * 1.1;
        } else {
          fz = 0.1;
          fx = m.strafe;
        }
        break;
      }
    }

    // --- Counter-strafe: briefly stop lateral movement when firing for accuracy ---
    const shouldCounterStrafe = wellAimed && dist < 25 && m.state === "hunting";
    if (shouldCounterStrafe) {
      fx *= 0.15; // nearly stop to shoot accurately
    }

    // --- Peek shooting: strafe out, shoot, strafe back ---
    if (m.state === "hunting" && dist > 15 && dist < 40 && this.rng() < 0.015) {
      m.peekDir = m.peekDir * -1;
      m.peekPhase = m.peekPhase === "in" ? "out" : "in";
      m.peekUntil = now + 300 + this.rng() * 200;
    }
    if (now < m.peekUntil && m.state === "hunting") {
      fx = m.peekDir * 1.0;
      fz = 0.1;
    }

    // --- Fire decision ---
    const inRange = dist < wpn.range * 0.95;
    const canFire = wellAimed && inRange && m.state !== "retreating" && m.state !== "fleeing" && m.state !== "repositioning";
    let fire = false;

    if (canFire && now >= m.aimAt && p.ammo > 0) {
      // Vary burst length by distance
      if (now >= m.burstEnd) {
        // Start a new burst
        fire = true;
        const burstLen = dist < 10
          ? 200 + this.rng() * 400   // close range: longer spray
          : dist < 25
          ? 100 + this.rng() * 250   // mid range: medium burst
          : 60 + this.rng() * 140;   // long range: short taps
        m.burstEnd = now + burstLen;
        m.burstCooldown = now + burstLen + 200 + this.rng() * 300;

        // Counter-strafe burst: stop, shoot, then resume
        if (shouldCounterStrafe) {
          m.strafe = 0;
        }
      } else if (now < m.burstEnd) {
        // In the middle of a burst
        fire = true;
      } else {
        // Between bursts — small chance to fire a single tap
        if (this.rng() < 0.08) {
          fire = true;
          m.burstEnd = now + 40;
        }
      }
    }

    // --- Crouch spam during gunfights ---
    let crouch = false;
    if (m.state === "hunting" && dist < 20 && fire) {
      m.crouchToggle += DT;
      // Toggle crouch every 0.3-0.6 seconds during fight
      const crouchInterval = 0.3 + this.rng() * 0.3;
      if (m.crouchToggle >= crouchInterval) {
        crouch = !p.move.crouching;
        m.crouchToggle = 0;
      } else {
        crouch = p.move.crouching; // maintain current crouch state
      }
    }

    // --- Jump: bunny hop to be harder to hit, or jump shot ---
    let jump = false;
    if (p.move.y === 0) {
      m.jumpCooldown -= DT;
      if (m.jumpCooldown <= 0) {
        if (m.state === "hunting" && dist < 12 && fire && this.rng() < 0.012) {
          jump = true;
          m.jumpCooldown = 0.8;
        } else if (m.state === "fleeing" && this.rng() < 0.04) {
          jump = true;
          m.jumpCooldown = 0.6;
        } else if (m.state === "repositioning" && this.rng() < 0.02) {
          jump = true;
          m.jumpCooldown = 0.5;
        }
      }
    }

    // --- Sprint: when repositioning or closing distance aggressively ---
    const sprint = (m.state === "repositioning" || m.state === "fleeing") ||
      (m.state === "hunting" && dist > m.preferDistance * 1.5);

    return {
      seq: 0,
      yaw: p.yaw,
      pitch: p.pitch,
      fx,
      fz,
      buttons: {
        fire,
        jump,
        sprint,
        crouch,
      },
    };
  }
}
