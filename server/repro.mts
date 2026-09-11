import { Client, Room } from "colyseus.js";
import { MSG, type PartyRoomState, type GameRoomState } from "@shooter/shared";
import { createApp, type AppHandle } from "./src/app";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const handle: AppHandle = createApp({ port: 0 });
const base = handle.url;
const ws = `ws://localhost:${handle.port}`;

function waitFor<T>(fn: () => T | undefined, ms: number, desc: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v !== undefined) {
        clearInterval(iv);
        resolve(v);
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error("timeout: " + desc));
      }
    }, 80);
  });
}

try {
  const r = await fetch(`${base}/api/auth/guest`, { method: "POST" });
  const g = await r.json();
  console.log("guest:", g.user.id);

  const client = new Client(ws);
  const room = (await client.create("party", { token: g.token })) as unknown as Room<PartyRoomState>;
  await waitFor(() => room.state?.code?.length ? room.state.code : undefined, 5000, "party code");
  console.log("party code:", room.state.code);

  room.onMessage(MSG.JOIN_MATCH, async (d: any) => {
    console.log("got join_match:", d.code, "map", d.mapId);
    let match: Room<GameRoomState>;
    try {
      match = (await client.joinById(d.code, { token: d.token })) as unknown as Room<GameRoomState>;
      console.log("joinById resolved OK");
    } catch (e: any) {
      console.error("joinById THREW:", e?.message ?? e, "| code:", JSON.stringify(e?.code));
      process.exit(1);
      return;
    }
    try {
      await waitFor(() => (match.state?.mapId ? true : undefined), 8000, "match state");
      console.log("state OK: map", match.state.mapId, "players", match.state.players.size);
    } catch (e: any) {
      console.error("STATE NEVER ARRIVED:", e?.message ?? e);
      process.exit(1);
      return;
    }
    await sleep(4000); // let countdown advance
    console.log("match state now:", match.state.state, "countdown", match.state.countdown, "score", match.state.scoreA + "/" + match.state.scoreB);
    console.log("ALL GOOD");
    process.exit(0);
  });

  room.send(MSG.READY, true);
  await sleep(200);
  room.send(MSG.FIND_MATCH, {});
  console.log("sent READY + FIND_MATCH, waiting for invite...");

  await sleep(15000);
  console.log("TIMEOUT - no join_match received");
  process.exit(1);
} finally {
  await handle.close();
}