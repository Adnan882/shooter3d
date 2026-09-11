import { MapBox, MapConfig, MapTheme, SpawnPoint, registerMap } from "./types";

function box(
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  color: string,
  opts: Partial<Pick<MapBox, "emissive" | "collidable" | "shape">> = {},
): MapBox {
  return {
    min: { x: x - w / 2, y: 0, z: z - d / 2 },
    max: { x: x + w / 2, y: h, z: z + d / 2 },
    color,
    collidable: opts.collidable ?? true,
    emissive: opts.emissive,
    shape: opts.shape ?? "box",
  };
}

function spawns(zIn: number, yaw: number): SpawnPoint[] {
  return [
    { pos: { x: -2, y: 0, z: zIn }, yaw },
    { pos: { x: 2, y: 0, z: zIn }, yaw },
    { pos: { x: -8, y: 0, z: zIn - 2 }, yaw },
  ];
}

interface Theme {
  theme: MapTheme;
  name: string;
  groundColor: string;
  accentColor: string;
  skyColor: string;
  skylight: string;
  sunlight: string;
  fogDensity: number;
  wall: string;
  wallAlt: string;
  crate: string;
  accent: string;
}

const THEMES: Record<MapTheme, Theme> = {
  desert: {
    theme: "desert",
    name: "Scorched Compound",
    groundColor: "#c8b98a",
    accentColor: "#f2b34c",
    skyColor: "#6ea8d4",
    skylight: "#dfe9f2",
    sunlight: "#fff3d6",
    fogDensity: 0.004,
    wall: "#c29a6b",
    wallAlt: "#a97e52",
    crate: "#8a6a3f",
    accent: "#efd9a0",
  },
  urban: {
    theme: "urban",
    name: "Canal Block",
    groundColor: "#8b929c",
    accentColor: "#4cc9f0",
    skyColor: "#94a3ad",
    skylight: "#cfe0ea",
    sunlight: "#f4f8fb",
    fogDensity: 0.005,
    wall: "#6f7784",
    wallAlt: "#5b6270",
    crate: "#39424e",
    accent: "#8aa1b8",
  },
  jungle: {
    theme: "jungle",
    name: "Amber Outpost",
    groundColor: "#5d7a47",
    accentColor: "#a3e635",
    skyColor: "#8fbf78",
    skylight: "#e4f0d8",
    sunlight: "#fff8e0",
    fogDensity: 0.006,
    wall: "#6b4f33",
    wallAlt: "#5a4130",
    crate: "#4b3a28",
    accent: "#c9a75d",
  },
};

function buildMap(t: Theme, extra: MapBox[]): MapConfig {
  const side = 30;
  const boxes: MapBox[] = [
    // corner structures
    box(-16, -16, 7, 7, 5, t.wall),
    box(-16, -16, 3, 3, 7, t.wallAlt, { emissive: t.accent }),
    box(16, -16, 7, 7, 5, t.wall),
    box(16, -16, 3, 3, 7, t.wallAlt, { emissive: t.accent }),
    box(-16, 16, 7, 7, 5, t.wall),
    box(-16, 16, 3, 3, 7, t.wallAlt, { emissive: t.accent }),
    box(16, 16, 7, 7, 5, t.wall),
    box(16, 16, 3, 3, 7, t.wallAlt, { emissive: t.accent }),

    // mid walls
    box(0, -16, 11, 3, 3.2, t.wall),
    box(0, 16, 11, 3, 3.2, t.wall),
    box(-16, 0, 3, 11, 3.2, t.wall),
    box(16, 0, 3, 11, 3.2, t.wall),

    // central tower
    box(0, 0, 5, 5, 7.5, t.wall, { emissive: t.accent }),

    // crates in the open lanes
    box(6, 6, 3, 3, 2.4, t.crate),
    box(-6, 6, 3, 3, 2.4, t.crate),
    box(6, -6, 3, 3, 2.4, t.crate),
    box(-6, -6, 3, 3, 2.4, t.crate),

    // low single crates near mid walls
    box(6, 0, 1.6, 1.6, 1.5, t.crate),
    box(-6, 0, 1.6, 1.6, 1.5, t.crate),
    box(0, 6, 1.6, 1.6, 1.5, t.crate),
    box(0, -6, 1.6, 1.6, 1.5, t.crate),

    // diagonal barriers
    box(11, 11, 3, 3, 2, t.wallAlt),
    box(-11, 11, 3, 3, 2, t.wallAlt),
    box(11, -11, 3, 3, 2, t.wallAlt),
    box(-11, -11, 3, 3, 2, t.wallAlt),
  ];

  return {
    id: t.theme,
    name: t.name,
    theme: t.theme,
    groundColor: t.groundColor,
    accentColor: t.accentColor,
    skyColor: t.skyColor,
    skylight: t.skylight,
    sunlight: t.sunlight,
    fogDensity: t.fogDensity,
    bounds: {
      min: { x: -side, y: 0, z: -side },
      max: { x: side, y: 40, z: side },
    },
    spawnA: spawns(-24, 0),
    spawnB: spawns(24, Math.PI),
    boxes: [...boxes, ...extra],
  };
}

registerMap(
  buildMap(THEMES.desert, [
    // scattered small rocks / barrels (visual flavor)
    box(-21, -8, 1.2, 1.2, 1, THEMES.desert.crate, { collidable: false }),
    box(19, 9, 1.2, 1.2, 1, THEMES.desert.crate, { collidable: false }),
    box(-19, 12, 1.2, 1.2, 1, THEMES.desert.crate, { collidable: false }),
    box(21, -12, 1.2, 1.2, 1, THEMES.desert.crate, { collidable: false }),
  ]),
);

registerMap(
  buildMap(THEMES.urban, [
    // chin-high concrete barriers
    box(-14, -8, 3, 0.9, 1.6, THEMES.urban.accent, { emissive: "#3aa8d0" }),
    box(14, -8, 3, 0.9, 1.6, THEMES.urban.accent, { emissive: "#3aa8d0" }),
    box(-14, 8, 3, 0.9, 1.6, THEMES.urban.accent, { emissive: "#3aa8d0" }),
    box(14, 8, 3, 0.9, 1.6, THEMES.urban.accent, { emissive: "#3aa8d0" }),
    // jumpable low wallstrips
    box(-9, -16.4, 2.2, 0.9, 1.2, THEMES.urban.wallAlt),
    box(9, -16.4, 2.2, 0.9, 1.2, THEMES.urban.wallAlt),
    box(-9, 16.4, 2.2, 0.9, 1.2, THEMES.urban.wallAlt),
    box(9, 16.4, 2.2, 0.9, 1.2, THEMES.urban.wallAlt),
  ]),
);

registerMap(
  buildMap(THEMES.jungle, [
    // trunk pillars (visual cylinders overlapped by thin colliders)
    box(-22, -6, 0.8, 0.8, 6, "#5a4130", { shape: "cylinder" }),
    box(22, -6, 0.8, 0.8, 6, "#5a4130", { shape: "cylinder" }),
    box(-22, 6, 0.8, 0.8, 6, "#5a4130", { shape: "cylinder" }),
    box(22, 6, 0.8, 0.8, 6, "#5a4130", { shape: "cylinder" }),
    box(-7, 22, 0.8, 0.8, 6, "#5a4130", { shape: "cylinder" }),
    box(7, 22, 0.8, 0.8, 6, "#5a4130", { shape: "cylinder" }),
    box(-7, -22, 0.8, 0.8, 6, "#5a4130", { shape: "cylinder" }),
    box(7, -22, 0.8, 0.8, 6, "#5a4130", { shape: "cylinder" }),
    // leafy canopies over the trunks (visual only)
    box(-22, -6, 3.4, 3.4, 0.6, "#3f5d2f", { collidable: false }),
    box(22, -6, 3.4, 3.4, 0.6, "#3f5d2f", { collidable: false }),
    box(-22, 6, 3.4, 3.4, 0.6, "#3f5d2f", { collidable: false }),
    box(22, 6, 3.4, 3.4, 0.6, "#3f5d2f", { collidable: false }),
    box(-7, 22, 3.4, 3.4, 0.6, "#3f5d2f", { collidable: false }),
    box(7, 22, 3.4, 3.4, 0.6, "#3f5d2f", { collidable: false }),
    box(-7, -22, 3.4, 3.4, 0.6, "#3f5d2f", { collidable: false }),
    box(7, -22, 3.4, 3.4, 0.6, "#3f5d2f", { collidable: false }),
  ]),
);