import { test } from "node:test";
import assert from "node:assert/strict";
import type { Room } from "colyseus";
import { Matchmaker, botSeatsFor, type MatchEntry } from "../src/matchmaker";
import type { AuthService } from "../src/auth";

const noopAuth = {} as unknown as AuthService;

function entry(room: Room, uid: string): MatchEntry {
  return {
    room,
    players: [{ sessionId: "s-" + uid, uid, name: "p" + uid }],
  };
}

test("addEntry ignores the same party while it is already queued", () => {
  const m = new Matchmaker(noopAuth, 1);
  const room = { roomId: "r1" } as unknown as Room;
  m.addEntry(entry(room, "a"));
  m.addEntry(entry(room, "a"));
  assert.equal((m as unknown as { entries: MatchEntry[] }).entries.length, 1);
  assert.equal(m.isQueued(room), true);
});

test("removeForConnection clears only the matching party member", () => {
  const m = new Matchmaker(noopAuth, 1);
  const room = { roomId: "r1" } as unknown as Room;
  m.addEntry(entry(room, "a"));
  m.removeForConnection(room, "s-a");
  assert.equal(m.isQueued(room), false);
});

test("botSeatsFor pads both teams to full size", () => {
  const seats = botSeatsFor(3, 1, 0);
  assert.equal(seats.length, 5);
  assert.equal(seats.filter((s) => s.team === 0).length, 2);
  assert.equal(seats.filter((s) => s.team === 1).length, 3);
  assert.ok(seats.every((s) => s.uid.startsWith("bot-")));
  assert.ok(seats.every((s) => s.name.endsWith("_BOT")));
});