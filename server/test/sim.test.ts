import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAYER, type MapConfig, type BoxCollider } from "@shooter/shared";
import { Simulation, type GameInput } from "../src/sim/Simulation";

function tinyMap(boxes: BoxCollider[] = []): MapConfig {
  return {
    id: "test",
    name: "Test",
    theme: "desert",
    groundColor: "#888",
    accentColor: "#ff0",
    skyColor: "#222",
    skylight: "#fff",
    sunlight: "#fff",
    fogDensity: 0,
    bounds: { min: { x: -100, y: 0, z: -100 }, max: { x: 100, y: 40, z: 100 } },
    spawnA: [
      { pos: { x: -2, y: 0, z: -24 }, yaw: 0 },
      { pos: { x: 2, y: 0, z: -24 }, yaw: 0 },
    ],
    spawnB: [
      { pos: { x: -2, y: 0, z: 24 }, yaw: Math.PI },
      { pos: { x: 2, y: 0, z: 24 }, yaw: Math.PI },
    ],
    boxes: boxes.map((b) => ({ min: b.min, max: b.max, color: "#f00", collidable: true })),
  };
}

function input(over: Partial<GameInput> = {}): GameInput {
  return {
    seq: 1,
    yaw: 0,
    pitch: 0,
    fx: 0,
    fz: 0,
    buttons: { fire: false, jump: false, sprint: false, crouch: false },
    ...over,
  };
}

test("walking approaches walk speed and y is grounded", () => {
  const sim = new Simulation(tinyMap());
  const a = sim.addPlayer("a", "A", 0);
  sim.setInput("a", input({ yaw: 0, fz: 1 }));
  for (let i = 0; i < 90; i++) sim.tick(1000 + i * 33, true);
  assert.ok(Math.abs(a.move.x - -2) < 0.001, "no lateral drift with fx=0");
  assert.ok(a.move.z > -20, "moved along +Z for yaw=0");
  assert.ok(Math.abs(a.move.y) < 0.001, "stays grounded");
  const traveled = a.move.z - -24;
  const speed = traveled / (90 * 0.033);
  assert.ok(speed <= PLAYER.walkSpeed * 1.05, `speed ${speed} <= walk`);
});

test("jump gives positive vy then returns to ground", () => {
  const sim = new Simulation(tinyMap());
  const a = sim.addPlayer("a", "A", 0);
  sim.setInput("a", input({ buttons: { fire: false, jump: true, sprint: false, crouch: false } }));
  sim.tick(1000, true);
  assert.ok(a.move.vy > 0, "vy is upward after jump");
  sim.setInput("a", input({ seq: 2, buttons: { fire: false, jump: false, sprint: false, crouch: false } }));
  for (let i = 0; i < 200; i++) sim.tick(1000 + i * 33, true);
  assert.ok(Math.abs(a.move.y) < 0.001, "back on ground");
});

test("stale/duplicate seq inputs are rejected", () => {
  const sim = new Simulation(tinyMap());
  const a = sim.addPlayer("a", "A", 0);
  sim.setInput("a", input({ seq: 5, fz: 1 }));
  sim.setInput("a", input({ seq: 3, fz: -1 }));
  sim.tick(1000, true);
  assert.ok(a.move.z > -24, "used seq 5 (forward), not seq 3 (backward)");
});

test("box collision keeps player outside a solid box", () => {
  const box: BoxCollider = { min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 3, z: 2 } };
  const sim = new Simulation(tinyMap([box]));
  const a = sim.addPlayer("a", "A", 0);
  a.move.x = 0;
  a.move.z = 0;
  sim.tick(1000, false);
  const r = PLAYER.radius;
  const inside =
    a.move.x > -2 + r && a.move.x < 2 - r && a.move.z > -2 + r && a.move.z < 2 - r;
  assert.ok(!inside, `player pushed out (x=${a.move.x}, z=${a.move.z})`);
});

test("hitscan damages enemy on body shot", () => {
  const sim = new Simulation(tinyMap());
  const a = sim.addPlayer("a", "A", 0);
  const b = sim.addPlayer("b", "B", 1);
  a.move.x = 0;
  a.move.z = 0;
  b.move.x = 0;
  b.move.z = 10;
  const before = b.health;
  sim.setInput("a", input({ yaw: 0, buttons: { fire: true, jump: false, sprint: false, crouch: false } }));
  const events = sim.tick(1000, true);
  assert.ok(b.health < before, "enemy took damage");
  assert.ok(events.some((e) => e.type === "hit"), "hit event emitted");
  assert.ok(!events.some((e) => e.type === "kill"), "no kill yet");
});

test("world geometry blocks hitscan", () => {
  const sim = new Simulation(
    tinyMap([{ min: { x: -50, y: 0, z: 4 }, max: { x: 50, y: 3, z: 6 } }]),
  );
  const a = sim.addPlayer("a", "A", 0);
  const b = sim.addPlayer("b", "B", 1);
  a.move.x = 0;
  a.move.z = 0;
  b.move.x = 0;
  b.move.z = 20;
  const before = b.health;
  sim.setInput("a", input({ yaw: 0, buttons: { fire: true, jump: false, sprint: false, crouch: false } }));
  sim.tick(1000, true);
  assert.equal(b.health, before, "wall between shooter and target blocks the shot");
});

test("killing awards score and respawns the victim", () => {
  const sim = new Simulation(tinyMap());
  const a = sim.addPlayer("a", "A", 0);
  const b = sim.addPlayer("b", "B", 1);
  a.move.x = 0;
  a.move.z = 0;
  b.move.x = 0;
  b.move.z = 10;
  b.health = 5;
  sim.setInput("a", input({ yaw: 0, buttons: { fire: true, jump: false, sprint: false, crouch: false } }));
  const events = sim.tick(1000, true);
  assert.ok(events.some((e) => e.type === "kill"), "kill event");
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
  assert.equal(sim.score[0], 1, "team score incremented");
  assert.ok(!b.alive, "victim is dead");
  const respawnAt = b.respawnAt;
  sim.tick(respawnAt + 1, false);
  assert.ok(b.alive, "victim respawned after delay");
});

test("bot moves toward and kills an idle enemy", () => {
  const sim = new Simulation(tinyMap(), () => 0.5);
  const a = sim.addPlayer("a", "A", 0);
  const b = sim.addPlayer("bot-1", "Rex_BOT", 1, true);
  a.move.x = 0;
  a.move.z = 0;
  b.move.x = 0;
  b.move.z = 20;
  b.yaw = Math.PI;
  const before = b.move.z;
  let now = 10000;
  let killed = false;
  for (let i = 0; i < 240 && !killed; i++) {
    const events = sim.tick(now, true);
    if (events.some((e) => e.type === "kill" && e.killerId === b.id)) killed = true;
    now += 33;
  }
  assert.ok(killed, "bot killed the idle enemy");
  assert.ok(!a.alive, "victim is dead");
  assert.equal(a.deaths, 1);
  assert.ok(b.move.z < before - 0.1, "bot advanced toward the enemy");
  assert.equal(sim.score[1], 1, "bot team scored");
});

test("winnerForScore returns the first team to hit the target", () => {
  const sim = new Simulation(tinyMap());
  const a = sim.addPlayer("a", "A", 0);
  const b = sim.addPlayer("b", "B", 1);
  a.move.x = 0;
  a.move.z = 0;
  const target = sim.scoreTarget;
  let now = 1000;
  let n = 1;
  while (sim.winnerForScore(target) === -1 && n < 5000) {
    a.ammo = 30;
    a.reserve = 500;
    a.fireCooldown = 0;
    a.reloadingUntil = 0;
    b.move.x = 0;
    b.move.z = 10;
    b.health = 5;
    b.alive = true;
    sim.setInput("a", input({ seq: ++n, yaw: 0, buttons: { fire: true, jump: false, sprint: false, crouch: false } }));
    sim.tick(now, true);
    now += 33;
  }
  assert.equal(sim.winnerForScore(target), 0, "team A wins");
  assert.equal(sim.score[0], target);
});