import { defineTypes, MapSchema, ArraySchema, Schema } from "@colyseus/schema";

export class PlayerState extends Schema {
  declare id: string;
  declare name: string;
  declare team: number;
  declare health: number;
  declare alive: boolean;
  declare x: number;
  declare y: number;
  declare z: number;
  declare yaw: number;
  declare pitch: number;
  declare weapon: number;
  declare ammo: number;
  declare reserve: number;
  declare crouching: boolean;
  declare reloading: boolean;
  declare kills: number;
  declare deaths: number;

  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.team = 0;
    this.health = 100;
    this.alive = true;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.weapon = 0;
    this.ammo = 0;
    this.reserve = 0;
    this.crouching = false;
    this.reloading = false;
    this.kills = 0;
    this.deaths = 0;
  }
}

defineTypes(PlayerState, {
  id: "string",
  name: "string",
  team: "int8",
  health: "int16",
  alive: "boolean",
  x: "float32",
  y: "float32",
  z: "float32",
  yaw: "float32",
  pitch: "float32",
  weapon: "int8",
  ammo: "int16",
  reserve: "int16",
  crouching: "boolean",
  reloading: "boolean",
  kills: "int16",
  deaths: "int16",
});

export class KillFeedItem extends Schema {
  declare killerId: string;
  declare killerName: string;
  declare victimId: string;
  declare victimName: string;
  declare weapon: string;
  declare headshot: boolean;
  declare at: number;

  constructor() {
    super();
    this.killerId = "";
    this.killerName = "";
    this.victimId = "";
    this.victimName = "";
    this.weapon = "";
    this.headshot = false;
    this.at = 0;
  }
}

defineTypes(KillFeedItem, {
  killerId: "string",
  killerName: "string",
  victimId: "string",
  victimName: "string",
  weapon: "string",
  headshot: "boolean",
  at: "float64",
});

export class GameRoomState extends Schema {
  declare mapId: string;
  declare mode: string;
  declare state: string;
  declare countdown: number;
  declare scoreA: number;
  declare scoreB: number;
  declare timeLeft: number;
  declare scoreTarget: number;
  declare players: MapSchema<PlayerState>;
  declare killFeed: ArraySchema<KillFeedItem>;

  constructor() {
    super();
    this.mapId = "";
    this.mode = "tdm";
    this.state = "countdown";
    this.countdown = 0;
    this.scoreA = 0;
    this.scoreB = 0;
    this.timeLeft = 0;
    this.scoreTarget = 0;
    this.players = new MapSchema<PlayerState>();
    this.killFeed = new ArraySchema<KillFeedItem>();
  }
}

defineTypes(GameRoomState, {
  mapId: "string",
  mode: "string",
  state: "string",
  countdown: "int8",
  scoreA: "int8",
  scoreB: "int8",
  timeLeft: "int16",
  scoreTarget: "int16",
  players: { map: PlayerState },
  killFeed: { array: KillFeedItem },
});

export class PartyMember extends Schema {
  declare id: string;
  declare name: string;
  declare ready: boolean;
  declare leader: boolean;

  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.ready = false;
    this.leader = false;
  }
}

defineTypes(PartyMember, {
  id: "string",
  name: "string",
  ready: "boolean",
  leader: "boolean",
});

export class PartyRoomState extends Schema {
  declare code: string;
  declare members: MapSchema<PartyMember>;

  constructor() {
    super();
    this.code = "";
    this.members = new MapSchema<PartyMember>();
  }
}

defineTypes(PartyRoomState, {
  code: "string",
  members: { map: PartyMember },
});

export class EmptyState extends Schema {}

defineTypes(EmptyState, {});