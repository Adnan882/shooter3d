import { Client, Room } from "colyseus";
import { MSG, PartyMember, PartyRoomState } from "@shooter/shared";
import { deps } from "../deps";

export class PartyRoom extends Room<PartyRoomState> {
  maxClients = 10;

  onCreate() {
    this.setState(new PartyRoomState());
    this.state.code = this.roomId;

    this.onMessage(MSG.READY, (client, value: boolean) => {
      const member = this.state.members.get(client.auth.uid);
      if (member) member.ready = !!value;
    });

    this.onMessage(MSG.FIND_MATCH, (client) => {
      const leader = this.leaderId();
      if (client.auth.uid !== leader) return;
      if (deps.matchmaker?.isQueued(this)) return;

      const members = [...this.state.members.values()];
      if (members.length === 0) return;
      if (!members.every((m) => m.ready)) {
        client.send(MSG.MATCH_ERROR, { reason: "Everyone must be ready" });
        return;
      }

      const teamSize = deps.matchmaker?.getTeamSize() ?? 5;
      if (members.length > teamSize) {
        client.send(MSG.MATCH_ERROR, { reason: `Parties can be up to ${teamSize} players` });
        return;
      }

      deps.matchmaker?.addEntry({
        room: this,
        players: members.map((m) => {
          const c = this.clients.find((cl) => cl.auth?.uid === m.id);
          return { sessionId: c?.sessionId ?? "", uid: m.id, name: m.name };
        }),
      });
    });
  }

  async onAuth(_client: Client, options: { token?: string }): Promise<{ uid: string; name: string } | false> {
    if (!options?.token) return false;
    const auth = deps.auth;
    if (!auth) return false;
    const user = await auth.fromToken(options.token);
    if (!user) return false;
    return { uid: user.id, name: user.displayName };
  }

  onJoin(client: Client) {
    const members = this.state.members;
    const existing = members.get(client.auth.uid);
    if (existing) {
      existing.name = client.auth.name;
      return;
    }
    const member = new PartyMember();
    member.id = client.auth.uid;
    member.name = client.auth.name;
    member.leader = members.size === 0;
    members.set(member.id, member);
  }

  onLeave(client: Client) {
    const uid = client.auth?.uid;
    if (!uid || !this.state.members.has(uid)) return;
    const wasLeader = this.state.members.get(uid)!.leader;
    this.state.members.delete(uid);
    if (wasLeader && this.state.members.size > 0) {
      const next = [...this.state.members.values()][0];
      next.leader = true;
    }
    this.broadcast("party_members", {});
  }

  private leaderId(): string | null {
    for (const m of this.state.members.values()) if (m.leader) return m.id;
    return null;
  }
}