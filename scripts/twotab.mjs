// Simulates TWO TABS in ONE browser profile:
//  - Tab A boots and becomes guest G (fresh identity).
//  - Tab B is seeded with the SAME stored token (shared localStorage) BEFORE
//    the app boots, so under the old code both tabs were the same player
//    and the second one's match join was rejected as a duplicate.
// Asserts: after the per-tab guest fix, both tabs get DISTINCT identities,
// both queue, and both boot to playing WITHOUT the join alert.
import puppeteer from "puppeteer-core";

const APP = "http://localhost:5173/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, ms, desc) {
  const t0 = Date.now();
  for (;;) {
    try {
      const ok = await page.evaluate(fn);
      if (ok) return;
    } catch {}
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${desc}`);
    await sleep(100);
  }
}

function track(page, label, errs) {
  page.on("pageerror", (e) => errs.push(`${label} pageerror: ` + e.message.slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(`${label} console: ` + m.text().slice(0, 160));
  });
  page.on("dialog", (d) => {
    errs.push(`DIALOG: ${d.message().slice(0, 120)}`);
    d.dismiss();
  });
}

async function toPartyAndFind(page, label) {
  await waitFor(page, () => !!document.querySelector("#btn-quick"), 15000, `${label} home`);
  await page.click("#btn-quick");
  await waitFor(page, () => !!document.querySelector("#party"), 15000, `${label} party`);
  await waitFor(page, () => !!document.querySelector("#btn-ready"), 8000, `${label} ready`);
  await page.click("#btn-ready");
  await waitFor(
    page,
    () => {
      const b = document.querySelector("#btn-find");
      return !!b && !b.disabled;
    },
    10000,
    `${label} find enabled`,
  );
}

async function boot(page, label) {
  await waitFor(page, () => !!document.querySelector("#game-canvas"), 20000, `${label} canvas`);
  await waitFor(page, () => !!document.querySelector("#loading"), 15000, `${label} loading`);
  await waitFor(page, () => !document.querySelector("#loading"), 25000, `${label} playing`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1280,720", "--hide-scrollbars", "--mute-audio"],
});

const failures = [];
try {
  const ctxA = await browser.createBrowserContext();
  const pageA = await ctxA.newPage();
  const errsA = [];
  track(pageA, "A", errsA);

  // TAB A: fresh boot, becomes guest G, identity lives in per-tab storage.
  await pageA.goto(APP, { waitUntil: "networkidle2" });
  await toPartyAndFind(pageA, "A");
  const tokenA = await pageA.evaluate(() => {
    const tok = localStorage.getItem("shooter_token") || sessionStorage.getItem("shooter_guest");
    const name = [...document.querySelectorAll(".member")].map((m) => m.textContent.replace(/\s+/g, " ").trim()).join("|") || "?";
    return { tok, name };
  });
  console.log("A tab A identity stored" + (tokenA.tok ? " (token present)" : ""));

  // TAB B: same profile (shared localStorage), seeded BEFORE the app boots.
  const ctxB = await browser.createBrowserContext();
  const pageB = await ctxB.newPage();
  const errsB = [];
  track(pageB, "B", errsB);
  await pageB.evaluateOnNewDocument((t) => {
    try {
      localStorage.setItem("shooter_token", t);
    } catch {}
  }, tokenA.tok);
  await pageB.goto(APP, { waitUntil: "networkidle2" });
  await toPartyAndFind(pageB, "B");
  const tokenB = await pageB.evaluate(
    () => localStorage.getItem("shooter_token") || sessionStorage.getItem("shooter_guest"),
  );

  const distinct = tokenA.tok && tokenB && tokenA.tok !== tokenB;
  console.log("B distinct identities: " + (distinct ? "YES" : "NO (bug)"));
  if (!distinct) failures.push("tabs share one identity token");

  // Make FIND jobs meet: A queues first, B queues ~300ms later (same lobby).
  await pageA.click("#btn-find");
  await sleep(300);
  await pageB.click("#btn-find");

  const before = Date.now();
  await Promise.all([boot(pageA, "A"), boot(pageB, "B")]);
  console.log(`C both tabs booted to playing in ${((Date.now() - before) / 1000).toFixed(1)}s`);

  await sleep(1200);
  for (const [label, errs] of [["A", errsA], ["B", errsB]]) {
    const fatal = errs.filter((e) => !/favicon|ERR_|net::|Failed to load resource/.test(e));
    if (fatal.some((e) => e.startsWith("DIALOG"))) failures.push(`${label}: join alert fired → ${fatal.join(" | ")}`);
    else if (fatal.length) failures.push(`${label}: ${fatal.slice(0, 3).join(" | ")}`);
    console.log(`D ${label} errors: ${fatal.length ? fatal.join(" | ") : "none"}`);
  }

  await ctxA.close();
  await ctxB.close();
} catch (e) {
  failures.push("FLOW: " + e.message);
  console.error("E twotab error:", e.message);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nTWOTAB FAILED:\n - " + failures.join("\n - "));
  process.exit(1);
}
console.log("\nTWOTAB PASSED: two profile-sharing tabs queue and both boot to playing (no join alert)");
process.exit(0);