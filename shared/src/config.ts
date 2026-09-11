export const GAME = {
  /** Players per team. Default 5v5; the server overrides this at runtime via TEAM_SIZE env. */
  defaultTeamSize: 5,
  tickRate: 30,
  tickMs: () => 1000 / GAME.tickRate,
  countdownSec: 3,
  tdmScoreTarget: 20,
  matchTimeLimitSec: 300,
  respawnTimeMs: 3000,
} as const;

export const PLAYER = {
  radius: 0.4,
  height: 1.8,
  eyeHeight: 1.6,
  crouchEyeHeight: 1.15,
  walkSpeed: 4.2,
  sprintSpeed: 6.4,
  crouchSpeed: 2.4,
  jumpSpeed: 7.2,
  gravity: 18,
  maxFallSpeed: 40,
  accel: 14,
  airAccel: 3,
  health: 100,
} as const;

export interface WeaponStats {
  key: string;
  name: string;
  damage: number;
  headshotMultiplier: number;
  fireIntervalMs: number;
  /** hitscan range in world units */
  range: number;
  magSize: number;
  reloadMs: number;
  moveSpeedMultiplier: number;
  auto: boolean;
}

export const WEAPONS: Record<string, WeaponStats> = {
  rifle: {
    key: "rifle",
    name: "VX-7 Rifle",
    damage: 16,
    headshotMultiplier: 1.8,
    fireIntervalMs: 115,
    range: 250,
    magSize: 30,
    reloadMs: 1700,
    moveSpeedMultiplier: 0.85,
    auto: true,
  },
  pistol: {
    key: "pistol",
    name: "M9 Sidearm",
    damage: 22,
    headshotMultiplier: 1.5,
    fireIntervalMs: 240,
    range: 140,
    magSize: 12,
    reloadMs: 1200,
    moveSpeedMultiplier: 1,
    auto: false,
  },
} as const;

export const WEAPON_KEYS = ["rifle", "pistol"] as const;