import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { statSync } from "node:fs";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { AuthResponse, AuthUser } from "@shooter/shared";
import { AuthService, AuthError } from "./auth";
import { deps } from "./deps";
import { Matchmaker } from "./matchmaker";
import { GameRoom } from "./rooms/GameRoom";
import { PartyRoom } from "./rooms/PartyRoom";
import { QueueRoom } from "./rooms/QueueRoom";

function publicUser(u: { id: string; displayName: string; isGuest: boolean; stats?: AuthUser["stats"] }): AuthUser {
  return { id: u.id, displayName: u.displayName, isGuest: u.isGuest, stats: u.stats };
}

function bearer(req: express.Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  if (h.startsWith("Bearer ")) return h.slice(7);
  return h;
}

export interface AppHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export function createApp(opts: { port?: number } = {}): AppHandle {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const auth = new AuthService({});
  deps.auth = auth;

  app.post("/api/auth/guest", async (_req, res) => {
    try {
      const user = await auth.guest();
      const body: AuthResponse = { token: auth.issueToken(user), user: publicUser(user) };
      return res.json(body);
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const user = await auth.register(
        String(req.body?.email ?? ""),
        String(req.body?.password ?? ""),
        String(req.body?.displayName ?? ""),
      );
      const body: AuthResponse = { token: auth.issueToken(user), user: publicUser(user) };
      return res.json(body);
    } catch (e) {
      if (e instanceof AuthError) return res.status(400).json({ error: e.message });
      return res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const user = await auth.login(String(req.body?.email ?? ""), String(req.body?.password ?? ""));
      const body: AuthResponse = { token: auth.issueToken(user), user: publicUser(user) };
      return res.json(body);
    } catch (e) {
      if (e instanceof AuthError) return res.status(401).json({ error: e.message });
      return res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const user = await auth.fromToken(token);
    if (!user) return res.status(401).json({ error: "unauthorized" });
    return res.json({ user: publicUser(user) });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  const httpServer = createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });

  gameServer.define("party", PartyRoom);
  gameServer.define("queue", QueueRoom);
  gameServer.define("match", GameRoom);

  const matchmaker = new Matchmaker(auth);
  deps.matchmaker = matchmaker;

  // serve built client for simple production deploys
  const clientDist = new URL("../../client/dist", import.meta.url).pathname;
  try {
    if (statSync(clientDist).isDirectory()) {
      app.use(express.static(clientDist));
      app.get(/^\/join\/.+/, (_req, res) => res.sendFile(clientDist + "/index.html"));
      app.get("/", (_req, res) => res.sendFile(clientDist + "/index.html"));
    }
  } catch {
    // client not built yet
  }

  const port = opts.port ?? 2567;
  httpServer.listen(port);
  const boundPort = (httpServer.address() as AddressInfo).port;
  void matchMaker.onReady.then(() => matchMaker.create("queue", {}));

  return {
    get url() {
      return `http://localhost:${boundPort}`;
    },
    port: boundPort,
    async close() {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await gameServer.gracefullyShutdown(false).catch(() => {});
    },
  };
}