import { Room } from "colyseus.js";
import type { GameRoomState, MatchEndMessage } from "@shooter/shared";
import { GameApp } from "../game/GameApp";
import { showLoading } from "./LoadingScreen";
import { waitUntil } from "../dom";
import { getUser } from "../auth";

export interface GameScreenHandle {
  dispose: () => void;
}

export interface GameScreenOptions {
  onEnd: (msg: MatchEndMessage) => void;
  onQuit: () => void;
}

export async function startGame(
  room: Room<GameRoomState>,
  opts: GameScreenOptions,
): Promise<GameScreenHandle> {
  await waitUntil(() => {
    const s = room.state;
    return Boolean(s?.mapId && s?.state && s?.players);
  }, 8000, "match state");

  const myId = getUser()?.id ?? "";
  const canvas = document.createElement("canvas");
  canvas.id = "game-canvas";
  document.body.appendChild(canvas);

  const game = new GameApp(canvas, room, myId, opts);

  let cleanupLoading: (() => void) | null = null;
  if (room.state.state !== "playing") {
    cleanupLoading = showLoading(room);
  }

  return {
    dispose() {
      cleanupLoading?.();
      game.dispose();
      canvas.remove();
    },
  };
}