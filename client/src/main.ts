import "./styles.css";
import type { Room } from "colyseus.js";
import type { GameRoomState, MatchEndMessage } from "@shooter/shared";
import { ensureGuest } from "./auth";
import { getColyseusClient, type JoinMatchData } from "./net";
import { showHome } from "./screens/HomeScreen";
import { showParty, getPartyRoom } from "./screens/PartyScreen";
import { startGame, type GameScreenHandle } from "./screens/GameScreen";
import { showResults } from "./screens/ResultsScreen";

let currentGame: GameScreenHandle | null = null;
let activeMatchRoom: Room<GameRoomState> | null = null;

async function goHome() {
  showHome(() => {
    void goParty(null, true);
  });
}

async function goParty(code: string | null, create: boolean) {
  await showParty(code, create, (d) => void joinMatch(d), () => void goHome());
}

async function joinMatch(d: JoinMatchData) {
  try {
    const client = getColyseusClient();
    const room = await client.joinById(d.code, { token: d.token });
    activeMatchRoom = room;
    currentGame?.dispose();
    currentGame = await startGame(room, {
      onEnd: (msg) => onMatchEnd(msg),
      onQuit: () => quitMatch(),
    });
  } catch {
    alert("Could not join the match (it may be full or already started).");
    void goParty(getPartyRoom()?.state.code ?? null, false);
  }
}

function quitMatch() {
  currentGame?.dispose();
  currentGame = null;
  try {
    activeMatchRoom?.leave();
  } catch {}
  activeMatchRoom = null;
  void goHome();
}

function onMatchEnd(msg: MatchEndMessage) {
  currentGame?.dispose();
  currentGame = null;
  const room = activeMatchRoom;
  showResults(msg, () => {
    try {
      room?.leave();
    } catch {}
    activeMatchRoom = null;
    const pr = getPartyRoom();
    if (pr) void goParty(pr.state.code, false);
    else void goHome();
  });
}

async function boot() {
  try {
    await ensureGuest();
  } catch {
    // auth server unreachable; show a friendly error on home
  }
  const m = location.pathname.match(/^\/join\/([A-Za-z0-9]+)\/?$/);
  if (m) {
    await goParty(m[1], false);
  } else {
    await goHome();
  }
}

window.addEventListener("unload", () => {
  try {
    activeMatchRoom?.leave();
  } catch {}
});

void boot();