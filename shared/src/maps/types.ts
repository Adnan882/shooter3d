export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface BoxCollider {
  min: V3;
  max: V3;
}

export interface SpawnPoint {
  pos: V3;
  /** world yaw the player should face when spawned */
  yaw: number;
}

export interface MapBox {
  min: V3;
  max: V3;
  color: string;
  emissive?: string;
  /** if false: rendered on the client but ignored by server collision */
  collidable: boolean;
  shape?: "box" | "cylinder";
}

export type MapTheme = "desert" | "urban" | "jungle";

export interface MapConfig {
  id: string;
  name: string;
  theme: MapTheme;
  groundColor: string;
  accentColor: string;
  skyColor: string;
  skylight: string;
  sunlight: string;
  fogDensity: number;
  bounds: BoxCollider;
  spawnA: SpawnPoint[];
  spawnB: SpawnPoint[];
  boxes: MapBox[];
}

export function getMap(id: string): MapConfig | undefined {
  return MAPS.find((m) => m.id === id);
}

export const MAPS: MapConfig[] = [];
export function registerMap(map: MapConfig): void {
  MAPS.push(map);
}
export function randomMap(): MapConfig {
  return MAPS[Math.floor(Math.random() * MAPS.length)];
}

export function collidersOf(map: MapConfig): BoxCollider[] {
  return map.boxes.filter((b) => b.collidable).map((b) => ({ min: b.min, max: b.max }));
}