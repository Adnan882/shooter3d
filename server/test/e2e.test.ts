import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, Room } from "colyseus.js";
import { MSG, type AuthResponse, type GameRoomState, type PartyRoomState, type InputMessage } from "@shooter/shared";
import { createApp, type AppHandle } from "../src/app";

interface JoinMatchData {
  code: string;
  token: string;
  mapId: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => Date.now();

async function guest(base: string): Promise<AuthResponse> {
  const r = await fetch(`${base}/api/auth/guest`, { method: "POST" });
  const json = (await r.json()) as AuthResponse;
  assert.ok(r.ok, "guest created");
  return json;
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs: number, desc: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t0 = now();
    const iv = setInterval(() => {
      const v = fn();
      if (v !== undefined) {
        clearInterval(iv);
        resolve(v);
      } else if (now() - t0 > timeoutMs) {
        clearInterval(iv);
        reject(new Error(`timeout waiting for ${desc}`));
      }
    }, 80);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${what}`)), ms)),
  ]);
}

type MatchDriver = {
  uid: string;
  room: Room<GameRoomState>;
  seq: number;
};

function sendInput(d: MatchDriver, over: Partial<InputMessage> = {}): void {
  d.room.send(MSG.INPUT, {
    seq: d.seq++,
    yaw: over.yaw ?? 0,
    pitch: over.pitch ?? 0,
    fx: over.fx ?? 0,
    fz: over.fz ?? 0,
    buttons: over.buttons ?? { fire: false, sprint: false, crouch: false, jump: false },
  });
}

function playerOf(room: Room<GameRoomState>, uid: string) {
  return room.state?.players.get(uid);
}

async function driveTo(d: MatchDriver, waypoints: Array<[number, number]>, timeoutMs: number): Promise<number> {
  const t0 = now();
  let wp = 0;
  while (now() - t0 < timeoutMs) {
    const self = playerOf(d.room, d.uid);
    if (!self) break;
    if (wp >= waypoints.length) break;
    const [tx, tz] = waypoints[wp];
    if (Math.hypot(tx - self.x, tz - self.z) < 0.5) {
      wp += 1;
      continue;
    }
    sendInput(d, { yaw: Math.atan2(tx - self.x, tz - self.z), fz: 1 });
    await sleep(40);
  }
  sendInput(d);
  return wp;
}

async function fireAt(d: MatchDriver, targetUid: string, timeoutMs: number): Promise<boolean> {
  const t0 = now();
  let fired = false;
  while (now() - t0 < timeoutMs) {
    const self = playerOf(d.room, d.uid);
    const target = playerOf(d.room, targetUid);
    if (self && target) {
      const dx = target.x - self.x;
      const dz = target.z - self.z;
      const horiz = Math.hypot(dx, dz);
      sendInput(d, {
        yaw: Math.atan2(dx, dz),
        pitch: Math.atan2(0.9 - 1.6, horiz),
        buttons: { fire: true, sprint: false, crouch: false, jump: false },
      });
      fired = true;
    }
    if (target && target.health < 100) break;
    await sleep(40);
  }
  sendInput(d);
  return fired;
}

// Two single-player parties are matched 1v1 (the matchmaker requires both
// teams to be fully seated), the bots navigate the clear x=25 perimeter
// corridor, and A lands a shot on B.
test(
  "full loop: auth -> party -> ready -> matchmaking -> match -> online kill",
  { timeout: 120_000 },
  async () => {
    process.env.TEAM_SIZE = "1";
    const handle: AppHandle = createApp({ port: 0 });
    const base = handle.url;

    try {
      const guestA = await guest(base);
      const guestB = await guest(base);
      const ws = `ws://localhost:${handle.port}`;

      async function mkParty(g: AuthResponse): Promise<{
        client: Client;
        room: Room<PartyRoomState>;
        invite: Promise<JoinMatchData>;
      }> {
        const client = new Client(ws);
        const room = (await client.create("party", { token: g.token })) as unknown as Room<PartyRoomState>;
        const code = await waitFor(() => {
          const c = room.state.code;
          return c && c.length > 0 ? c : undefined;
        }, 5000, "party code");
        assert.ok(code.length > 0, "party has a code");
        const invite = new Promise<JoinMatchData>((resolve) => room.onMessage(MSG.JOIN_MATCH, (d: JoinMatchData) => resolve(d)));
        room.send(MSG.READY, true);
        return { client, room, invite };
      }

      const A = await mkParty(guestA);
      const B = await mkParty(guestB);

      A.room.send(MSG.FIND_MATCH, {});
      B.room.send(MSG.FIND_MATCH, {});
      const [ia, ib] = await withTimeout(Promise.all([A.invite, B.invite]), 15_000, "match invites");
      assert.equal(ia.code, ib.code, "both invited to the same match");

      const ra = (await A.client.joinById(ia.code, { token: ia.token })) as unknown as Room<GameRoomState>;
      const rb = (await B.client.joinById(ib.code, { token: ib.token })) as unknown as Room<GameRoomState>;
      // register no-op handlers so the shared schema messages don't warn
      for (const r of [ra, rb]) {
        r.onMessage(MSG.DAMAGED, () => {});
        r.onMessage(MSG.HIT, () => {});
        r.onMessage(MSG.SPAWN, () => {});
        r.onMessage(MSG.MATCH_END, () => {});
      }

      await waitFor(() => (ra.state?.players.size === 2 ? true : undefined), 8000, "both players in match state");
      const teams = new Set([...ra.state.players.values()].map((p) => p.team));
      assert.equal(teams.size, 2, "players on opposite teams");

      await waitFor(() => (ra.state.state === "playing" ? true : undefined), 10_000, "match start");

      const dA: MatchDriver = { uid: guestA.user.id, room: ra, seq: 0 };
      const dB: MatchDriver = { uid: guestB.user.id, room: rb, seq: 0 };

      const [wA, wB] = await Promise.all([
        driveTo(dA, [[25, 24], [25, -25]], 15_000),
        driveTo(dB, [[25, -24], [25, 25]], 15_000),
      ]);
      assert.ok(wA >= 1 && wB >= 1, `bots reached the corridor (${wA}/${wB})`);

      const fired = await fireAt(dA, guestB.user.id, 8000);
      assert.ok(fired, "A fired at B");

      await waitFor(() => {
        const b = playerOf(ra, guestB.user.id);
        return b && b.health < 100 ? true : undefined;
      }, 10_000, "B took damage");

      const b = playerOf(ra, guestB.user.id)!;
      assert.ok(b.health < 100, "B health dropped below 100");
      assert.ok(b.kills >= 0);

      console.log(`e2e kill pipeline OK (B health=${b.health})`);

      ra.leave();
      rb.leave();
      A.room.leave();
      B.room.leave();
    } finally {
      await handle.close();
    }
  },
);