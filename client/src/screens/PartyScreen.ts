import { Room } from "colyseus.js";
import { MSG, type PartyRoomState, type PartyMember } from "@shooter/shared";
import { getUser, getToken } from "../auth";
import { getColyseusClient, type JoinMatchData } from "../net";
import { waitUntil } from "../dom";
import { getInstanceCallbacks, getMapCallbacks } from "../schemaCallbacks";

let partyRoom: Room<PartyRoomState> | null = null;
let handlersWired = false;
let finding = false;
let onMatchInviteRef: (d: JoinMatchData) => void = () => {};
let onExitRef: () => void = () => {};

function refreshParty() {
  const room = partyRoom;
  if (!room) return;
  renderParty(document.getElementById("app")!, room)();
}

export function getPartyRoom() {
  return partyRoom;
}
export function leaveParty() {
  if (partyRoom) {
    try {
      partyRoom.leave();
    } catch {}
  }
  partyRoom = null;
  handlersWired = false;
  finding = false;
}

export async function showParty(
  code: string | null,
  onCreate: boolean,
  onMatchInvite: (d: JoinMatchData) => void,
  onExit: () => void,
): Promise<(() => void) | null> {
  const token = getToken();
  if (!token) {
    onExit();
    return null;
  }

  onMatchInviteRef = onMatchInvite;
  onExitRef = onExit;

  if (!partyRoom) {
    const client = getColyseusClient();
    try {
      partyRoom = onCreate
        ? await client.create("party", { token })
        : await client.joinById(code!, { token });
      await waitUntil(() => !!partyRoom?.state?.members, 8000, "party state");
    } catch {
      alert(onCreate ? "Could not create party." : "Party not found (wrong or expired link).");
      partyRoom = null;
      onExit();
      return null;
    }
  }

  const room = partyRoom;
  const app = document.getElementById("app")!;
  app.classList.remove("hidden");
  document.getElementById("hud")?.classList.add("hidden");

  wire(room);
  renderParty(app, room)();

  return () => {};
}

function wire(room: Room<PartyRoomState>) {
  if (handlersWired) return;
  handlersWired = true;

  const rerender = () => {
    if (partyRoom !== room) return;
    refreshParty();
  };

  room.onMessage(MSG.JOIN_MATCH, (d: JoinMatchData) => {
    if (partyRoom === room) {
      finding = false;
      onMatchInviteRef(d);
    }
  });
  room.onMessage(MSG.MATCH_ERROR, (m: { reason?: string }) => {
    if (partyRoom !== room) return;
    finding = false;
    alert(m.reason ?? "Matchmaking failed");
    rerender();
  });
  room.onLeave(() => {
    partyRoom = null;
    handlersWired = false;
    onExitRef();
  });

  const members = getMapCallbacks<PartyRoomState, "members", PartyMember>(room, "members");
  members.onAdd((m) => {
    getInstanceCallbacks(room, m).onChange(() => rerender());
    rerender();
  });
  members.onRemove(rerender);
}

function renderParty(app: HTMLElement, room: Room<PartyRoomState>) {
  const me = getUser();
  return () => {
    const members = [...room.state.members.values()];
    const my = me ? members.find((m) => m.id === me.id) : undefined;
    const isLeader = !!my?.leader;
    const count = members.length;
    const allReady = count > 0 && members.every((m) => m.ready);
    const myReady = !!my?.ready;
    const canFind = !!isLeader && allReady && !finding;
    const findLabel = finding ? "FINDING …" : isLeader ? "FIND MATCH" : "WAITING FOR LEADER...";

    app.innerHTML = "";
    const shell = document.createElement("div");
    shell.id = "party";
    shell.innerHTML = `
      <h2 class="mb-2">Party <span class="text-dim text-sm">code: ${room.state.code}</span></h2>
      <div class="members" id="party-members"></div>
      <button class="invite-link" id="party-invite" style="background:none;border:none;color:var(--accent);cursor:pointer">
        copy invite link (${count} member${count === 1 ? "" : "s"})
      </button>
      <div class="actions">
        <button class="btn btn-secondary" id="btn-ready">${myReady ? "UNREADY" : "READY"}</button>
        <button class="btn btn-primary" id="btn-find" ${canFind ? "" : "disabled"}>${findLabel}</button>
        <button class="btn btn-secondary" id="btn-leave">LEAVE</button>
      </div>`;
    app.appendChild(shell);

    const list = document.getElementById("party-members")!;
    for (const m of members) {
      const row = document.createElement("div");
      row.className = "member";
      row.innerHTML = `
        <span>${m.leader ? "&#128081;" : ""}&nbsp;${escapeHtml(m.name)}${m.id === me?.id ? " (you)" : ""}</span>
        <span class="${m.ready ? "ready" : "not-ready"}">${m.ready ? "READY" : "waiting"}</span>`;
      list.appendChild(row);
    }

    document.getElementById("btn-ready")!.onclick = () => {
      const nowReady = !myReady;
      room.send(MSG.READY, nowReady);
      if (nowReady && isLeader && count > 0) {
        finding = true;
        room.send(MSG.FIND_MATCH, {});
        refreshParty();
      }
    };
    document.getElementById("btn-find")!.onclick = () => {
      if (finding) return;
      finding = true;
      room.send(MSG.FIND_MATCH, {});
      refreshParty();
    };
    document.getElementById("btn-leave")!.onclick = () => {
      leaveParty();
      onExitRef();
    };
    document.getElementById("party-invite")!.onclick = async () => {
      const link = `${location.origin}/join/${room.state.code}`;
      try {
        await navigator.clipboard.writeText(link);
        alert("Invite link copied:\n" + link);
      } catch {
        prompt("Invite link:", link);
      }
    };
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}