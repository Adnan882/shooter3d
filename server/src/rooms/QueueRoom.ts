import { Client, Room } from "colyseus";
import { EmptyState, MSG } from "@shooter/shared";
import { deps } from "../deps";

/** Global waiting room used by Quick Play solo queueing. */
export class QueueRoom extends Room<EmptyState> {
  maxClients = 64;

  onCreate() {
    this.setState(new EmptyState());

    this.onMessage(MSG.JOIN_QUEUE, (client) => {
      deps.matchmaker?.addEntry({
        room: this,
        players: [
          { sessionId: client.sessionId, uid: client.auth.uid, name: client.auth.name },
        ],
      });
    });

    this.onMessage(MSG.LEAVE_QUEUE, (client) => {
      deps.matchmaker?.removeForConnection(this, client.sessionId);
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

  onJoin(_client: Client) {
    // client.auth carries identity from onAuth
  }

  onLeave(client: Client) {
    deps.matchmaker?.removeForConnection(this, client.sessionId);
  }
}