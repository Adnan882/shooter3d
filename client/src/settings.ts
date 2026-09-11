export const SETTINGS_KEY = "shooter3d.settings.v1";

export interface BindingDef {
  id: BindingId;
  label: string;
  default: string;
}

export const BINDING_DEFS: BindingDef[] = [
  { id: "forward", label: "Forward", default: "KeyW" },
  { id: "back", label: "Back", default: "KeyS" },
  { id: "left", label: "Left", default: "KeyA" },
  { id: "right", label: "Right", default: "KeyD" },
  { id: "jump", label: "Jump", default: "Space" },
  { id: "crouch", label: "Crouch", default: "ControlLeft" },
  { id: "sprint", label: "Sprint", default: "ShiftLeft" },
  { id: "reload", label: "Reload", default: "KeyR" },
  { id: "weapon1", label: "Weapon 1", default: "Digit1" },
  { id: "weapon2", label: "Weapon 2", default: "Digit2" },
];

export type BindingId =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "jump"
  | "crouch"
  | "sprint"
  | "reload"
  | "weapon1"
  | "weapon2";

export type Quality = "low" | "medium" | "high";

export interface ShooterSettings {
  /** keyboard: binding id -> KeyboardEvent.code */
  bindings: Record<BindingId, string>;
  mouseSens: number;
  mouseSensY: number;
  invertY: boolean;
  /** vertical field of view in degrees */
  fov: number;
  quality: Quality;
  /** rendered resolution multiplier (1 = native) */
  resolutionScale: number;
  shadows: boolean;
  effects: boolean;
  fullscreen: boolean;
  masterVol: number;
  sfxVol: number;
  musicVol: number;
  aimAssist: boolean;
  controllerSens: number;
}

const DEFAULT_BINDINGS = (): Record<BindingId, string> => {
  const m = {} as Record<BindingId, string>;
  for (const d of BINDING_DEFS) m[d.id] = d.default;
  return m;
};

export const DEFAULT_SETTINGS: ShooterSettings = {
  bindings: DEFAULT_BINDINGS(),
  mouseSens: 1,
  mouseSensY: 1,
  invertY: false,
  fov: 82,
  quality: "medium",
  resolutionScale: 1,
  shadows: false,
  effects: true,
  fullscreen: false,
  masterVol: 0.8,
  sfxVol: 0.9,
  musicVol: 0.5,
  aimAssist: true,
  controllerSens: 2.4,
};

function normalize(raw: Partial<ShooterSettings>): ShooterSettings {
  const d = DEFAULT_SETTINGS;
  const bindings = { ...d.bindings, ...(raw.bindings ?? {}) };
  for (const def of BINDING_DEFS) if (!bindings[def.id]) bindings[def.id] = def.default;
  return {
    ...d,
    ...raw,
    bindings,
    mouseSens: clampNum(raw.mouseSens, d.mouseSens, 0.1, 5),
    mouseSensY: clampNum(raw.mouseSensY, d.mouseSensY, 0.1, 5),
    fov: clampNum(raw.fov, d.fov, 60, 110),
    resolutionScale: clampNum(raw.resolutionScale, d.resolutionScale, 0.5, 2),
    masterVol: clampNum(raw.masterVol, d.masterVol, 0, 1),
    sfxVol: clampNum(raw.sfxVol, d.sfxVol, 0, 1),
    musicVol: clampNum(raw.musicVol, d.musicVol, 0, 1),
    controllerSens: clampNum(raw.controllerSens, d.controllerSens, 0.2, 8),
  };
}

function clampNum(v: number | undefined, d: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return d;
  return Math.min(max, Math.max(min, v));
}

let current: ShooterSettings = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "") as Partial<ShooterSettings>;
    return normalize(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
})();

type Listener = (s: ShooterSettings) => void;
const listeners = new Set<Listener>();
let version = 0;

export function getSettings(): ShooterSettings {
  return current;
}

export function getSettingsVersion(): number {
  return version;
}

export function updateSettings(patch: Partial<ShooterSettings>): ShooterSettings {
  current = normalize({ ...current, ...patch });
  version += 1;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  for (const fn of listeners) {
    try {
      fn(current);
    } catch {
      /* listener errors must not break saving */
    }
  }
  return current;
}

export function resetSettings(): ShooterSettings {
  return updateSettings({ ...DEFAULT_SETTINGS, bindings: defaultBindingsCopy() });
}

export function subscribeSettings(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function defaultBindingsCopy(): Record<BindingId, string> {
  return DEFAULT_BINDINGS();
}

export function keyLabel(code: string): string {
  return code
    .replace(/^Key([A-Z])$/, "$1")
    .replace(/^Digit([0-9])$/, "$1")
    .replace("ControlLeft", "L-CTRL")
    .replace("ShiftLeft", "L-SHIFT")
    .replace("Space", "SPACE");
}