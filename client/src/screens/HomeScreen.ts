import { getUser, logout, register, login } from "../auth";
import { openSettingsPanel } from "../settingsPanel";

let cleanup: (() => void) | null = null;
export function showHome(onPlay: (mode: "quick" | "party") => void) {
  const app = document.getElementById("app")!;
  showApp();

  const u = getUser();
  app.innerHTML = `
    <div id="home">
      <div class="brand">SHOOTER<span class="text-accent">3D</span></div>
      <div class="tagline">Browser Multiplayer 3D Team Shooter</div>
      <div class="action-row">
        <button class="btn btn-primary" id="btn-quick">QUICK PLAY</button>
        <button class="btn btn-secondary" id="btn-party">CREATE PARTY</button>
        <button class="btn btn-secondary" id="btn-settings">SETTINGS</button>
      </div>
      <div class="account">
        <span class="name">${u?.displayName ?? "Guest"}</span>
        <button class="btn btn-small btn-secondary" id="btn-auth">${u?.isGuest ? "Sign up / Log in" : "Logout"}</button>
      </div>
    </div>`;

  const qs = () => onPlay("quick");
  const ps = () => onPlay("party");
  document.getElementById("btn-quick")!.onclick = qs;
  document.getElementById("btn-party")!.onclick = ps;
  document.getElementById("btn-settings")!.onclick = () => openSettingsPanel({});
  document.getElementById("btn-auth")!.onclick = () => {
    if (u?.isGuest) return showModal();
    logout();
    showHome(onPlay);
  };
  cleanup = null;
  return () => cleanup?.();
}

function showApp() {
  document.getElementById("app")?.classList.remove("hidden");
  document.getElementById("hud")?.classList.add("hidden");
}

function showModal() {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <h3>Log in / Sign up</h3>
      <input id="m-email" type="email" placeholder="Email" />
      <input id="m-pass" type="password" placeholder="Password" />
      <input id="m-name" type="text" placeholder="Display name (signup only)" />
      <div class="flex gap-sm">
        <button class="btn btn-primary btn-small" id="m-login">Log in</button>
        <button class="btn btn-secondary btn-small" id="m-signup">Sign up</button>
        <button class="btn btn-secondary btn-small" id="m-cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  (modal.querySelector("#m-cancel") as HTMLElement)!.onclick = () => modal.remove();
  (modal.querySelector("#m-login") as HTMLElement)!.onclick = async () => {
    const email = (modal.querySelector("#m-email") as HTMLInputElement).value;
    const pass = (modal.querySelector("#m-pass") as HTMLInputElement).value;
    try {
      await login(email, pass);
      modal.remove();
      location.reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  (modal.querySelector("#m-signup") as HTMLElement)!.onclick = async () => {
    const email = (modal.querySelector("#m-email") as HTMLInputElement).value;
    const pass = (modal.querySelector("#m-pass") as HTMLInputElement).value;
    const name = (modal.querySelector("#m-name") as HTMLInputElement).value;
    try {
      await register(email, pass, name);
      modal.remove();
      location.reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };
}