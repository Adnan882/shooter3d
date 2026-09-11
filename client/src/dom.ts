export const $ = (sel: string, root: Document | HTMLElement = document) =>
  root.querySelector(sel) as HTMLElement | null;
export const $$ = (sel: string, root: Document | HTMLElement = document) =>
  [...root.querySelectorAll(sel)] as HTMLElement[];

export function mount(
  id: string,
  html: string,
  parent: HTMLElement = document.getElementById("app")!,
) {
  parent.innerHTML = "";
  parent.id = id;
  parent.classList.remove("hidden");
  parent.innerHTML = html;
  return parent;
}

export function hide(el?: HTMLElement | null) {
  if (el) el.classList.add("hidden");
}

export function show(el?: HTMLElement | null) {
  if (el) el.classList.remove("hidden");
}

export function showApp() {
  show(document.getElementById("app"));
  hide(document.getElementById("hud"));
  hide(document.getElementById("hud-overlay"));
}

export function showHud() {
  hide(document.getElementById("app"));
  show(document.getElementById("hud"));
}

export function hideHud() {
  hide(document.getElementById("hud"));
}

export function timeFmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function waitUntil(cond: () => boolean, ms: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      try {
        if (cond()) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - t0 > ms) {
          clearInterval(iv);
          reject(new Error(`timeout waiting for ${what}`));
        }
      } catch {
        clearInterval(iv);
        reject(new Error(`error while waiting for ${what}`));
      }
    }, 60);
  });
}