import express from "express";
import { createServer } from "node:http";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3567);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

// ---- static / vendor ----
const VENDOR_MAP = {
  "/vendor/three.js": "./node_modules/three/build/three.module.js",
  "/vendor/cannon-es.js": "./node_modules/cannon-es/dist/cannon-es.js",
  "/vendor/socket.io-client.js": "./node_modules/socket.io-client/dist/socket.io.esm.min.js",
};

app.use(express.static(join(__dirname, "public")));
for (const [route, rel] of Object.entries(VENDOR_MAP)) {
  const target = join(__dirname, rel);
  if (exists(target)) app.use(route, (_req, res) => res.sendFile(target));
}
// three.js example add-ons (GLTFLoader and its dependencies live under build/../examples/jsm)
app.use("/vendor", (req, res, next) => {
  const rel = "./node_modules/three/examples/jsm/" + req.path.replace(/^\//, "");
  const target = join(__dirname, rel);
  if (exists(target)) return res.sendFile(target);
  next();
});

const TEAM_A = 0;
const TEAM_B = 1;
const MAX_PER_TEAM = 5;

const PLAYERS = new Map(); // socket.id -> player

let lootSeq = 0;
const LOOT = new Map(); // id -> { id, x, z, item }

function exists(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function pickTeam() {
  let a = 0;
  let b = 0;
  for (const p of PLAYERS.values()) {
    if (p.team === TEAM_A) a++;
    else b++;
  }
  if (a <= b && a < MAX_PER_TEAM) return TEAM_A;
  if (b < MAX_PER_TEAM) return TEAM_B;
  return TEAM_A;
}

function roster() {
  return [...PLAYERS.values()].map(publicPlayer);
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, team: p.team, x: p.x, z: p.z, hp: p.hp };
}

function broadcastLootAdd(item, x, z) {
  const id = "loot-" + ++lootSeq;
  LOOT.set(id, { id, x, z, item });
  io.emit("loot:add", { id, x, z, item });
  return id;
}

function broadcastLootRemove(id) {
  if (!LOOT.delete(id)) return;
  io.emit("loot:remove", { id });
}

// ---- connection ----
io.on("connection", (socket) => {
  let player = null;

  socket.on("hello", (data) => {
    if (player) return;
    const name = String(data?.name ?? "").trim().slice(0, 20) || "Player" + Math.floor(Math.random() * 10000);
    const team = pickTeam();
    player = {
      id: socket.id,
      name,
      team,
      x: 0,
      z: 0,
      hp: 100,
      joinAt: Date.now(),
    };
    PLAYERS.set(socket.id, player);

    socket.emit("welcome", {
      id: socket.id,
      name,
      team,
      spawn: { x: team === TEAM_A ? -6 : 6, z: 0, facing: team === TEAM_A ? 0 : Math.PI },
      players: roster(),
      loot: [...LOOT.values()],
      maxPerTeam: MAX_PER_TEAM,
    });

    for (const other of PLAYERS.values()) {
      if (other.id === socket.id) continue;
      socket.emit("join", publicPlayer(other));
      io.to(other.id).emit("join", publicPlayer(player));
      // The older peer initiates the WebRTC offer.
      socket.emit("rtc:request", { with: other.id, initiator: false });
      io.to(other.id).emit("rtc:request", { with: socket.id, initiator: true });
    }
  });

  socket.on("rtc:offer", (m) => io.to(m.to).emit("rtc:offer", { from: socket.id, sdp: m.sdp }));
  socket.on("rtc:answer", (m) => io.to(m.to).emit("rtc:answer", { from: socket.id, sdp: m.sdp }));
  socket.on("rtc:ice", (m) => io.to(m.to).emit("rtc:ice", { from: socket.id, candidate: m.candidate }));

  // 60Hz relay fallback when a direct WebRTC channel is not yet open.
  socket.on("state", (m) => {
    if (!player) return;
    if (!m?.pkt || typeof m.pkt.x !== "number") return;
    player.x = m.pkt.x;
    player.z = m.pkt.z;
    const to = String(m.peer);
    const target = io.sockets.sockets.get(to);
    if (target) target.emit("state", { from: socket.id, pkt: m.pkt });
  });

  // authoritative-ish relayed actions (hurt / die / respawn / smoke / explode / chat)
  socket.on("action", (m) => {
    if (!player) return;
    if (m?.to) {
      const target = io.sockets.sockets.get(String(m.to));
      if (target) target.emit("action", { ...m, from: socket.id });
      return;
    }
    socket.broadcast.emit("action", { ...m, from: socket.id });
  });

  // ground loot mutations
  socket.on("loot:drop", (m) => {
    if (!player) return;
    if (m?.count > 6) return;
    (m?.items ?? []).forEach((item, i) => {
      if (!item?.id) return;
      const a = (i / Math.max(1, m.items.length)) * Math.PI * 2;
      const r = 1.2 + ((i % 3) * 0.4);
      broadcastLootAdd(item, player.x + Math.cos(a) * r, player.z + Math.sin(a) * r);
    });
  });
  socket.on("loot:take", (m) => {
    if (!player) return;
    broadcastLootRemove(String(m?.id));
  });

  socket.on("disconnect", () => {
    if (player) {
      PLAYERS.delete(socket.id);
      socket.broadcast.emit("leave", { id: socket.id, name: player.name });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[tactical] server on http://localhost:${PORT}`);
});