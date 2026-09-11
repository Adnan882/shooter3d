import { PLAYER } from "./config";

export interface MoveState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  crouching: boolean;
}

export interface MoveInput {
  yaw: number;
  fx: number;
  fz: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  dt: number;
}

export function createMoveState(x = 0, z = 0): MoveState {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, grounded: true, crouching: false };
}

/**
 * Grounded FPS movement model. Mutates `s`. Shared by the authoritative server
 * sim and the client's local prediction so both stay consistent.
 */
export function applyMovement(s: MoveState, i: MoveInput): void {
  let fx = Math.max(-1, Math.min(1, i.fx));
  let fz = Math.max(-1, Math.min(1, i.fz));
  const mag = Math.hypot(fx, fz);
  if (mag > 1) {
    fx /= mag;
    fz /= mag;
  }

  const fwdX = Math.sin(i.yaw);
  const fwdZ = Math.cos(i.yaw);
  const rightX = Math.cos(i.yaw);
  const rightZ = -Math.sin(i.yaw);

  let wishX = fwdX * fz + rightX * fx;
  let wishZ = fwdZ * fz + rightZ * fx;
  const wishMag = Math.hypot(wishX, wishZ);
  if (wishMag > 1) {
    wishX /= wishMag;
    wishZ /= wishMag;
  }

  const crouchWish = i.crouch && s.grounded;
  const sprinting = i.sprint && fz > 0.5 && !crouchWish;
  const speed = crouchWish
    ? PLAYER.crouchSpeed
    : sprinting
      ? PLAYER.sprintSpeed
      : PLAYER.walkSpeed;

  const accel = s.grounded ? PLAYER.accel : PLAYER.airAccel;
  const t = Math.min(1, accel * i.dt);

  s.vx += (wishX * speed - s.vx) * t;
  s.vz += (wishZ * speed - s.vz) * t;

  if (i.jump && s.grounded) {
    s.vy = PLAYER.jumpSpeed;
    s.grounded = false;
    s.crouching = false;
  }

  if (s.grounded) {
    s.vy = 0;
  }
  s.vy -= PLAYER.gravity * i.dt;
  if (s.vy < -PLAYER.maxFallSpeed) s.vy = -PLAYER.maxFallSpeed;

  s.x += s.vx * i.dt;
  s.y += s.vy * i.dt;
  s.z += s.vz * i.dt;

  if (s.y <= 0) {
    s.y = 0;
    s.vy = 0;
    s.grounded = true;
  }

  s.crouching = crouchWish;
}

/** Direction vector from yaw/pitch: yaw 0 = +Z, positive yaw turns toward +X. */
export function viewDirection(yaw: number, pitch: number) {
  const cp = Math.cos(pitch);
  return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: Math.cos(yaw) * cp };
}