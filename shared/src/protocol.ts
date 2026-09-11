export const MSG = {
  INPUT: "input",
  READY: "ready",
  FIND_MATCH: "find_match",
  LEAVE_MATCH: "leave_match",
  JOIN_MATCH: "join_match",
  MATCH_ERROR: "match_error",
  JOIN_QUEUE: "join_queue",
  LEAVE_QUEUE: "leave_queue",
  HIT: "hit", // time to shooter
  DAMAGED: "damaged", // to victim
  KILLFEED: "killfeed",
  MATCH_END: "match_end",
  RELOAD: "reload",
  SWITCH: "switch_weapon",
  SPAWN: "spawn",
} as const;

export interface InputButtons {
  fire: boolean;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
}

export interface InputMessage {
  seq: number;
  yaw: number;
  pitch: number;
  fx: number;
  fz: number;
  buttons: InputButtons;
}

export interface JoinMatchMessage {
  code: string;
  token: string;
  mapId: string;
}

export interface MatchErrorMessage {
  reason: string;
}

export interface DamagedMessage {
  amount: number;
  headshot: boolean;
  attackerName: string;
  attackerId: string;
}

export interface HitMessage {
  headshot: boolean;
}

export interface KillfeedMessage {
  killerName: string;
  victimName: string;
  weapon: string;
  headshot: boolean;
}

export interface PlayerResult {
  id: string;
  name: string;
  team: number;
  kills: number;
  deaths: number;
}

export interface MatchEndMessage {
  winnerTeam: number;
  scoreA: number;
  scoreB: number;
  results: PlayerResult[];
}

export interface AuthUser {
  id: string;
  displayName: string;
  isGuest: boolean;
  stats?: { kills: number; deaths: number; wins: number; matchesPlayed: number };
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface PartySendMessage {
  t: string;
  ready?: boolean;
  reason?: string;
  to?: string[]; // restricted broadcast (e.g., invite a member into a match)
}