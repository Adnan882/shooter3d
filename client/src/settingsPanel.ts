import {
  BINDING_DEFS,
  getSettings,
  keyLabel,
  resetSettings,
  updateSettings,
  type BindingId,
  type Quality,
} from "./settings";
import { audio } from "./audio";

type PanelTab = "controls" | "graphics" | "audio" | "controller";

export interface SettingsPanelOptions {
  onClose?: () => void;
}

export function openSettingsPanel(opts: SettingsPanelOptions = {}): () => void {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="settings-panel">
      <div class="settings-header">
        <h2>SETTINGS</h2>
        <button class="btn btn-small btn-secondary" id="set-close">Close</button>
      </div>
      <div class="settings-tabs">
        <button class="tab active" data-tab="controls">Controls</button>
        <button class="tab" data-tab="graphics">Graphics</button>
        <button class="tab" data-tab="audio">Audio</button>
        <button class="tab" data-tab="controller">Controller</button>
      </div>
      <div class="settings-body" id="set-body"></div>
      <div class="settings-footer">
        <button class="btn btn-small btn-secondary" id="set-reset">Restore defaults</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  let activeTab: PanelTab = "controls";
  let capturing: BindingId | null = null;

  const body = backdrop.querySelector("#set-body") as HTMLElement;

  const render = () => {
    const cfg = getSettings();
    let html = "";
    if (activeTab === "controls") {
      html = `
        <div class="set-group">
          <div class="set-label">Keyboard bindings</div>
          <div class="bind-list">
            ${BINDING_DEFS.map(
              (b) => `
              <div class="bind-row">
                <span class="bind-name">${b.label}</span>
                <button class="btn btn-small btn-secondary bind-key ${capturing === b.id ? "capturing" : ""}" data-bind="${b.id}">
                  ${capturing === b.id ? "PRESS A KEY…" : keyLabel(cfg.bindings[b.id])}
                </button>
              </div>`,
            ).join("")}
          </div>
          <div class="set-label">Mouse</div>
          ${sliderRow("Mouse sensitivity (X)", "mouseSens", cfg.mouseSens, 0.1, 5, 0.05, "x")}
          ${sliderRow("Mouse sensitivity (Y)", "mouseSensY", cfg.mouseSensY, 0.1, 5, 0.05, "x")}
          ${toggleRow("Invert mouse Y", "invertY", cfg.invertY)}
        </div>`;
    } else if (activeTab === "graphics") {
      html = `
        <div class="set-group">
          ${sliderRow("Field of view", "fov", cfg.fov, 60, 110, 1, "°")}
          <div class="set-row"><label>Quality preset</label>
            <select id="inp-quality">
              ${(["low", "medium", "high"] as Quality[])
                .map((q) => `<option value="${q}" ${cfg.quality === q ? "selected" : ""}>${q[0].toUpperCase() + q.slice(1)}</option>`)
                .join("")}
            </select></div>
          ${sliderRow("Resolution scale", "resolutionScale", cfg.resolutionScale, 0.5, 2, 0.05, "x")}
          ${toggleRow("Shadows", "shadows", cfg.shadows)}
          ${toggleRow("Effects (fog, muzzle flash)", "effects", cfg.effects)}
          ${toggleRow("Fullscreen", "fullscreen", cfg.fullscreen)}
        </div>`;
    } else if (activeTab === "audio") {
      html = `
        <div class="set-group">
          ${sliderRow("Master volume", "masterVol", cfg.masterVol, 0, 1, 0.01, "%")}
          ${sliderRow("Sound effects", "sfxVol", cfg.sfxVol, 0, 1, 0.01, "%")}
          ${sliderRow("Music", "musicVol", cfg.musicVol, 0, 1, 0.01, "%")}
          <div class="set-row"><button class="btn btn-small btn-secondary" id="set-preview">Test sound</button></div>
        </div>`;
    } else {
      html = `
        <div class="set-group">
          ${sliderRow("Controller look sensitivity", "controllerSens", cfg.controllerSens, 0.2, 8, 0.2, "x")}
          ${toggleRow("Aim assist", "aimAssist", cfg.aimAssist)}
          <div class="set-label">Layout</div>
          <table class="ctl-layout">
            <tr><td>Move</td><td>Left stick</td></tr>
            <tr><td>Look</td><td>Right stick</td></tr>
            <tr><td>Fire</td><td>Right trigger (RT / R2)</td></tr>
            <tr><td>Jump</td><td>A / Cross</td></tr>
            <tr><td>Crouch</td><td>Left bumper (LB / L1)</td></tr>
            <tr><td>Sprint</td><td>B / Circle</td></tr>
            <tr><td>Reload</td><td>Y / Triangle</td></tr>
            <tr><td>Swap weapon</td><td>Right bumper (RB / R1)</td></tr>
          </table>
        </div>`;
    }
    body.innerHTML = html;
    wireControls();
  };

  const wireControls = () => {
    if (activeTab === "controls") {
      body.querySelectorAll<HTMLElement>(".bind-key").forEach((btn) => {
        btn.onclick = () => {
          const id = btn.dataset.bind as BindingId;
          capturing = capturing === id ? null : id;
          render();
        };
      });
      body.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((inp) => {
        inp.oninput = () => updateSettings({ [inp.dataset.key as string]: Number(inp.value) });
      });
      const invY = body.querySelector<HTMLInputElement>("#inp-invertY");
      if (invY) invY.onchange = () => updateSettings({ invertY: invY.checked });
    } else if (activeTab === "graphics") {
      body.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((inp) => {
        inp.oninput = () => updateSettings({ [inp.dataset.key as string]: Number(inp.value) });
      });
      body.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
        cb.onchange = () => updateSettings({ [cb.dataset.key as string]: cb.checked });
      });
      const q = body.querySelector<HTMLSelectElement>("#inp-quality");
      if (q) q.onchange = () => updateSettings({ quality: q.value as Quality });
    } else if (activeTab === "audio") {
      body.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((inp) => {
        inp.oninput = () => {
          updateSettings({ [inp.dataset.key as string]: Number(inp.value) });
          audio.setVolumes(getSettings());
        };
      });
      const preview = body.querySelector<HTMLElement>("#set-preview");
      if (preview) preview.onclick = () => audio.play("fire");
    } else {
      body.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((inp) => {
        inp.oninput = () => updateSettings({ [inp.dataset.key as string]: Number(inp.value) });
      });
      const cb = body.querySelector<HTMLInputElement>("input[type=checkbox]");
      if (cb) cb.onchange = () => updateSettings({ [cb.dataset.key as string]: cb.checked });
    }
  };

  // global capture handler while the panel is open
  const onKey = (e: KeyboardEvent) => {
    CapturingGuard.lastEvent = e;
    if (capturing) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        capturing = null;
      } else {
        updateSettings({ bindings: { ...getSettings().bindings, [capturing]: e.code } });
        capturing = null;
      }
      render();
    }
  };
  window.addEventListener("keydown", onKey, true);

  backdrop.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
    tab.onclick = () => {
      capturing = null;
      activeTab = tab.dataset.tab as PanelTab;
      backdrop.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      render();
    };
  });
  backdrop.querySelector("#set-close")?.addEventListener("click", close);
  backdrop.querySelector("#set-reset")?.addEventListener("click", () => {
    resetSettings();
    audio.setVolumes(getSettings());
    render();
  });

  function close() {
    window.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    opts.onClose?.();
  }

  render();
  return close;
}

function sliderRow(label: string, key: string, value: number, min: number, max: number, step: number, unit: string) {
  const v = unit === "%" ? Math.round(value * 100) : round(value);
  return `
    <div class="set-row">
      <label>${label} <span class="set-val">${v}${unit}</span></label>
      <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}" />
    </div>`;
}

function toggleRow(label: string, key: string, checked: boolean) {
  return `
    <div class="set-row">
      <label>${label}</label>
      <label class="switch"><input type="checkbox" data-key="${key}" ${checked ? "checked" : ""} /><span class="slider"></span></label>
    </div>`;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** Allows the game to ignore the keypress that closes a settings panel. */
export const CapturingGuard = { lastEvent: null as KeyboardEvent | null };