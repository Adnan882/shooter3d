import type { MatchEndMessage } from "@shooter/shared";
import { showApp } from "../dom";

export function showResults(
  msg: MatchEndMessage,
  onContinue: () => void,
): () => void {
  const app = document.getElementById("app")!;
  showApp();
  app.innerHTML = "";
  const root = document.createElement("div");
  root.id = "results";

  const won = msg.winnerTeam;
  const aFirst = won === 0;
  const header =
    won === -1 ? "DRAW" : aFirst ? "TEAM A WINS" : "TEAM B WINS";
  const accent = won === -1 ? "" : aFirst ? "teamA" : "teamB";

  root.innerHTML = `
    <div class="title ${accent}">${header}</div>
    <div class="final-score">${msg.scoreA} – ${msg.scoreB}</div>
    <div class="panel">
      <div class="stats-table" id="results-table"></div>
    </div>
    <div class="actions" style="display:flex;gap:12px;margin-top:24px">
      <button class="btn btn-primary" id="btn-continue">BACK TO LOBBY</button>
    </div>`;
  app.appendChild(root);

  const rows = [...msg.results].sort((a, b) => b.kills - a.kills);
  const table = document.getElementById("results-table")!;
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "stat-row";
    row.innerHTML = `
      <span class="name ${r.team === 0 ? "teamA" : "teamB"}">${escapeHtml(r.name)}</span>
      <span class="kills">${r.kills} kills · ${r.deaths} deaths</span>`;
    table.appendChild(row);
  }

  document.getElementById("btn-continue")!.onclick = onContinue;

  return () => {
    app.innerHTML = "";
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}