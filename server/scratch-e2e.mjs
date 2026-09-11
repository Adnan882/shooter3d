process.env.TEAM_SIZE = "1";
process.on("uncaughtException", (e) => { console.error("UNCAUGHT", e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("UNHANDLED", e); process.exit(1); });
import { Client } from "colyseus.js";
import { MSG } from "@shooter/shared";
import { createApp } from "./src/app";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms))]);
async function main() {
  const handle = createApp({ port: 0 });
  const base = handle.url;
  const mkGuest = async () => (await fetch(`${base}/api/auth/guest`, { method: "POST" })).json();
  const a = await mkGuest();
  const b = await mkGuest();
  console.log("guests", a.user.id, b.user.id);

  const mkParty = async (guest) => {
    const c = new Client(`ws://localhost:${handle.port}`);
    const room = await c.create("party", { token: guest.token });
    let code = "";
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      code = room.state.code;
      if (code && code.length) break;
      await sleep(80);
    }
    const invite = new Promise((resolve) => room.onMessage(MSG.JOIN_MATCH, resolve));
    room.send(MSG.READY, true);
    return { c, room, guest, invite, code };
  };

  const A = await mkParty(a);
  const B = await mkParty(b);
  console.log("parties ready", A.code, B.code);
  A.room.send(MSG.FIND_MATCH, {});
  B.room.send(MSG.FIND_MATCH, {});
  const [ia, ib] = await Promise.all([
    withTimeout(A.invite, 15000, "A invite"),
    withTimeout(B.invite, 15000, "B invite"),
  ]);
  console.log("invites", ia.code, ib.code, "same?", ia.code === ib.code);

  const ra = await A.c.joinById(ia.code, { token: ia.token });
  const rb = await B.c.joinById(ib.code, { token: ib.token });
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    if (ra.state?.players?.size === 2 && rb.state?.players?.size === 2) break;
    await sleep(80);
  }
  console.log("players", ra.state?.players?.size, "state", ra.state?.state, "map", ra.state?.mapId);
  const t1 = Date.now();
  while (Date.now() - t1 < 10000) {
    if (ra.state?.state === "playing") break;
    await sleep(80);
  }
  console.log("playing?", ra.state?.state, "countdown", ra.state?.countdown);
  const pa = ra.state.players.get(a.user.id);
  const pb = ra.state.players.get(b.user.id);
  console.log("A", pa?.team, pa?.x, pa?.z, pa?.health, "| B", pb?.team, pb?.x, pb?.z, pb?.health);

  const makeDriver = (room, uid) => ({ room, uid, seq: 0 });
  const sendMove = (d, over = {}) => {
    d.room.send(MSG.INPUT, {
      seq: d.seq++,
      yaw: over.yaw ?? 0,
      pitch: over.pitch ?? 0,
      fx: over.fx ?? 0,
      fz: over.fz ?? 0,
      buttons: { fire: over.fire ?? false, sprint: over.sprint ?? false, crouch: over.crouch ?? false, jump: over.jump ?? false },
    });
  };
  const driveTo = async (d, wps, ms) => {
    const t = Date.now();
    let wi = 0;
    while (Date.now() - t < ms) {
      const self = d.room.state.players.get(d.uid);
      if (!self) break;
      if (wi >= wps.length) break;
      const [tx, tz] = wps[wi];
      if (Math.hypot(tx - self.x, tz - self.z) < 0.5) {
        wi += 1;
        continue;
      }
      sendMove(d, { yaw: Math.atan2(tx - self.x, tz - self.z), pitch: 0, fz: 1 });
      await sleep(40);
    }
    sendMove(d, {});
    return wi;
  };
  const fireAt = async (d, target, ms) => {
    let fired = false;
    const t = Date.now();
    while (Date.now() - t < ms) {
      const self = d.room.state.players.get(d.uid);
      const tar = d.room.state.players.get(target);
      if (self && tar) {
        const dx = tar.x - self.x;
        const dz = tar.z - self.z;
        const horiz = Math.hypot(dx, dz);
        sendMove(d, { yaw: Math.atan2(dx, dz), pitch: Math.atan2(0.9 - 1.6, horiz), fire: true });
        fired = true;
      }
      if (tar && tar.health < 100) break;
      await sleep(40);
    }
    sendMove(d, {});
    return fired;
  };

  const A_d = makeDriver(ra, a.user.id);
  const B_d = makeDriver(rb, b.user.id);
  const [wa, wb] = await Promise.all([
    driveTo(A_d, [[25, 24], [25, -25]], 15000),
    driveTo(B_d, [[25, -24], [25, 25]], 15000),
  ]);
  console.log("wps reached:", wa, wb);
  console.log("after drive  A", ra.state.players.get(a.user.id)?.x, ra.state.players.get(a.user.id)?.z, "| B", ra.state.players.get(b.user.id)?.x, ra.state.players.get(b.user.id)?.z);
  let damagedEvts = 0;
  let hitEvts = 0;
  rb.onMessage(MSG.DAMAGED, () => { damagedEvts += 1; });
  ra.onMessage(MSG.HIT, () => { hitEvts += 1; });
  const fired = await fireAt(A_d, b.user.id, 8000);
  const aSelf = ra.state.players.get(a.user.id);
  const bSelf = ra.state.players.get(b.user.id);
  console.log("fired?", fired, "damagedEvts", damagedEvts, "hitEvts", hitEvts, "A ammo", aSelf?.ammo, "A hp", aSelf?.health, "B hp", bSelf?.health);
  ra.leave(); rb.leave(); A.room.leave(); B.room.leave();
  await handle.close();
  console.log("DONE");
}
main().catch((e) => { console.error("MAINF", e); process.exit(1); });