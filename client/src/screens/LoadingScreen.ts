import { Room } from "colyseus.js";
import { getMap, type GameRoomState, type PlayerState } from "@shooter/shared";
import { showHud } from "../dom";
import { getMapCallbacks } from "../schemaCallbacks";

export function showLoading(room: Room<GameRoomState>) {
  showHud();
  let stopped = false;
  const root = document.createElement("div");
  root.id = "loading";
  root.innerHTML = `
    <div class="map-name">${escapeHtml(getMap(room.state.mapId)?.name ?? "Loading…")}</div>
    <div class="theme">team deathmatch</div>
    <div class="roster">
      <div class="team-col"><h4 class="teamA">TEAM A</h4></div>
      <div class="team-col"><h4 class="teamB">TEAM B</h4></div>
    </div>
    <div class="countdown" id="loading-countdown">…</div>`;
  document.body.appendChild(root);

  const rows = () => ({
    A: [...room.state.players.values()].filter((p) => p.team === 0),
    B: [...room.state.players.values()].filter((p) => p.team === 1),
  });
  const apply = () => {
    if (stopped) return;
    const { A, B } = rows();
    const cols = root.querySelectorAll(".team-col");
    const fill = (el: Element, teamName: string, xs: { name: string }[]) => {
      el.innerHTML = `<h4 class="${teamName === "TEAM A" ? "teamA" : "teamB"}">${teamName}</h4>` +
        xs.map((x) => `<div class="pname">${escapeHtml(x.name)}</div>`).join("");
    };
    fill(cols[0], "TEAM A", A);
    fill(cols[1], "TEAM B", B);
    const cd = document.getElementById("loading-countdown");
    if (cd) cd.textContent = preCountdownText(room);
  };
  const players = getMapCallbacks<GameRoomState, "players", PlayerState>(room, "players");
  players.onAdd(apply);
  players.onRemove(apply);

  const iv = setInterval(() => {
    const cd = document.getElementById("loading-countdown");
    if (cd) cd.textContent = preCountdownText(room);
    if (room.state.state === "playing") stop();
  }, 200);
  const stop = () => {
    stopped = true;
    clearInterval(iv);
    root.remove();
  };

  return stop;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function preCountdownText(room: Room<GameRoomState>) {
  const s = room.state;
  if (s.state === "playing") return "FIGHT!";
  if (s.state === "finished") return "MATCH OVER";
  return `${Math.max(0, s.countdown)}`;
}