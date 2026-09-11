import * as CANNON from "cannon-es";

/**
 * Cannon-es wrapper for the tactical shooter prototype.
 * - Static world (ground + walls + crates).
 * - Player bodies driven by explicit velocity (authoritative local prediction).
 * - Projectile bodies with gravity and contact events.
 * - Closest-hit raycast.
 */

const GRAVITY = -9.81;
const PLAYER_RADIUS = 0.45;
const PLAYER_MASS = 70;

export const PLAYER_SHAPE = { radius: PLAYER_RADIUS };

export class PhysWorld {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = false;

    const ground = new CANNON.Material("ground");
    const player = new CANNON.Material("player");
    const contact = new CANNON.ContactMaterial(player, ground, {
      friction: 0,
      restitution: 0,
    });
    this.world.addContactMaterial(contact);
    this.world.defaultContactMaterial.contactEquationStiffness = 1e8;
    this.world.defaultContactMaterial.contactEquationRelaxation = 4;
    this.groundMat = ground;
    this.playerMat = player;

    this.groundBody = this.addStaticBox(0, -0.5, 0, 1000, 0.5, 1000, "ground");
  }

  addStaticBox(x, y, z, hx, hy, hz, name = "static") {
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), position: new CANNON.Vec3(x, y, z), material: this.groundMat });
    this.world.addBody(body);
    return body;
  }

  /**
   * Create a player body. Movement is applied via setPlayerVelocity() each tick;
   * gravity and collision operate on the body's Y velocity.
   */
  createPlayer(pos) {
    const shape = new CANNON.Sphere(PLAYER_RADIUS);
    const body = new CANNON.Body({
      mass: PLAYER_MASS,
      shape,
      position: new CANNON.Vec3(pos.x, pos.y, pos.z),
      allowSleep: false,
      material: this.playerMat,
    });
    body.fixedRotation = true;
    body.angularFactor.set(0, 0, 0);
    body.linearDamping = 0.01;
    this.world.addBody(body);
    return body;
  }

  /** Directly set horizontal velocity toward the desired world direction. */
  setPlayerMove(body, dirX, dirZ, speed, jumpSpeed, delta) {
    const v = body.velocity;
    const k = 1 - Math.min(1, 12 * delta); // smoothing toward target speed
    const tx = dirX * speed;
    const tz = dirZ * speed;
    v.x = tx + (v.x - tx) * k;
    v.z = tz + (v.z - tz) * k;
    if (jumpSpeed > 0 && Math.abs(v.y) < 0.001) v.y = jumpSpeed;
    else if (body.position.y - this.floorY(body.position.x, body.position.z) < 0.05 && Math.abs(v.y) < 0.001) v.y = 0;
  }

  /** Exponential friction so the player stops sliding when input is released. */
  friction(body, factor, delta) {
    if (factor >= 1 || factor <= 0) return;
    const v = body.velocity;
    v.x *= Math.pow(factor, delta * 60);
    v.z *= Math.pow(factor, delta * 60);
    if (Math.hypot(v.x, v.z) < 0.02) {
      v.x = 0;
      v.z = 0;
    }
    const y = body.position.y;
    const floor = this.floorY(body.position.x, body.position.z);
    if (Math.abs(v.y) < 2 && Math.abs(y - floor) < 0.35) v.y = 0;
  }

  isGrounded(body) {
    const floor = this.floorY(body.position.x, body.position.z);
    return Math.abs(body.position.y - floor) < 0.14 && Math.abs(body.velocity.y) < 0.0001;
  }

  floorY(x, z) {
    // flat arena floor
    return 0;
  }

  /** Cast a closest ray; excludes the projectile body. */
  raycast(origin, dir, maxDist, originBody) {
    const from = new CANNON.Vec3(origin.x, origin.y, origin.z);
    const to = new CANNON.Vec3(
      origin.x + dir.x * maxDist,
      origin.y + dir.y * maxDist,
      origin.z + dir.z * maxDist,
    );
    const hit = this.world.raycastClosest(from, to, {
      skipBackfaces: false,
      collisionFilterMask: -1,
    });
    if (hit.hasHit && originBody && hit.body === originBody) {
      // shift and re-test (ray started inside the player's own body)
      const o2 = new CANNON.Vec3(origin.x + dir.x * 0.1 + up.y * 0.1, origin.y + up.y * 0.1, origin.z + dir.z * 0.1);
      const to2 = new CANNON.Vec3(o2.x + dir.x * maxDist, o2.y + dir.y * maxDist, o2.z + dir.z * maxDist);
      const hit2 = this.world.raycastClosest(o2, to2, { skipBackfaces: false, collisionFilterMask: -1 });
      return hit2.hasHit
        ? { point: { x: hit2.hitPointWorld.x, y: hit2.hitPointWorld.y, z: hit2.hitPointWorld.z }, body: hit2.body, distance: hit2.distance }
        : null;
    }
    return hit.hasHit
      ? { point: { x: hit.hitPointWorld.x, y: hit.hitPointWorld.y, z: hit.hitPointWorld.z }, body: hit.body, distance: hit.distance }
      : null;
  }

  createProjectile(pos, vel, radius = 0.18) {
    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(radius),
      position: new CANNON.Vec3(pos.x, pos.y, pos.z),
      velocity: new CANNON.Vec3(vel.x, vel.y, vel.z),
    });
    body.allowSleep = true;
    this.world.addBody(body);
    return body;
  }

  step(dt) {
    this.world.step(1 / 60, dt, 6);
  }

  removeBody(body) {
    this.world.removeBody(body);
  }
}

export const up = { x: 0, y: 1, z: 0 };