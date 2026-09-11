import { createApp } from "./app";

const port = Number(process.env.PORT) || 2567;
const handle = createApp({ port });

const info = [
  "",
  `  Shooter3D server running:`,
  `    HTTP+WS : http://localhost:${port}  (REST /api, Colyseus websocket)`,
  `    TEAM_SIZE: ${process.env.TEAM_SIZE ?? "5"} (players per team)`,
  "",
].join("\n");
console.log(info);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await handle.close();
    process.exit(0);
  });
}