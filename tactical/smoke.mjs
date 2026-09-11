import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:3567";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPlayer(browser, name) {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  await page.type("#name", name);
  await page.click("#join");
  await page.waitForFunction(() => document.getElementById("connecting").style.display === "none", { timeout: 8000 });
  return { page, errors };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader", "--use-fake-ui-for-media-stream"],
});

const a = await newPlayer(browser, "Alpha");
await sleep(600);
const b = await newPlayer(browser, "Bravo");
await sleep(3500);

// player A moves forward for ~1.5s; player B should observe A's remote translate.
await a.page.keyboard.down("KeyW");
await sleep(1600);
await a.page.keyboard.up("KeyW");
await sleep(1000);

// characters are big GLBs; wait for the rigged model (RightHand bone) to render.
const waitForBones = async (p, label) => {
  for (let i = 0; i < 25; i++) {
    const n = await p.page.evaluate(() => window.__game?.characterBones ?? 0);
    if (n >= 1) return n;
    await sleep(400);
  }
  return 0;
};
const bonesA = await waitForBones(a, "A");
const bonesB = await waitForBones(b, "B");

const snapshot = async (p) =>
  await p.page.evaluate(() => ({
    hp: document.getElementById("hpval").textContent,
    clip: document.getElementById("clip").textContent,
    reserve: document.getElementById("reserve").textContent,
    remoteCount: window.__game?.remoteCount ?? -1,
    connectedPeers: window.__game?.connectedPeers ?? -1,
    remotePositions: window.__game?.remotePositions ? window.__game.remotePositions() : [],
  }));

const aSnap = await snapshot(a);
const bSnap = await snapshot(b);
console.log("player A:", JSON.stringify(aSnap));
console.log("player B:", JSON.stringify(bSnap));

let failures = 0;
for (const [label, p, snap] of [["A", a, aSnap], ["B", b, bSnap]]) {
  const errs = p.errors.filter((e) => !/404 \(Not Found\)/.test(e));
  if (errs.length) { console.log(`FAIL [${label}] console errors:`); errs.forEach((e) => console.log("   " + e)); failures++; }
  else console.log(`OK   [${label}] no console/network errors`);
}
console.log(`character bones rendered: A=${bonesA}, B=${bonesB}`);
if (bonesA < 1 || bonesB < 1) { console.log("FAIL: rigged character model did not render on a side"); failures++; }
else console.log("OK   : rigged character GLB renders (RightHand bone present)");

// remote movement via relay (WebRTC or socket fallback)
const movedX = Math.abs((bSnap.remotePositions[0] ?? [-6, 0])[0] - -6);
console.log(`B observes A's remote x-delta: ${movedX.toFixed(2)}m`);
if (aSnap.remoteCount < 1 || bSnap.remoteCount < 1) { console.log("FAIL: remote not registered on a side"); failures++; }
if (movedX < 1.0) { console.log("FAIL: remote player did not move (60Hz transform flow broken)"); failures++; }
else console.log("OK   : 60Hz transforms flow (remote moved)");

console.log(`\nSMOKE RESULT: ${failures ? failures + " FAILURE(S)" : "PASS"}`);
await browser.close();
process.exit(failures ? 1 : 0);