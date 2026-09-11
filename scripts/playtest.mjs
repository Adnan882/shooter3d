import puppeteer from "puppeteer-core";

const APP = "http://localhost:5173/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, ms, desc) {
  const t0 = Date.now();
  for (;;) {
    const ok = await page.evaluate(fn);
    if (ok) return;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${desc}`);
    await sleep(100);
  }
}

async function setupPage(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("console: " + m.text());
  });
  page.on("dialog", async (d) => {
    errs.push("dialog: " + d.message());
    await d.dismiss();
  });
  await page.goto(APP, { waitUntil: "networkidle2" });
  return { ctx, page, errs };
}

async function toPartyAndReady(page) {
  await waitFor(page, () => !!document.querySelector("#btn-quick"), 15000, "home screen");
  await page.click("#btn-quick");
  await waitFor(page, () => !!document.querySelector("#party"), 15000, "party screen");
  await waitFor(page, () => !!document.querySelector("#btn-ready"), 8000, "ready button");
  await page.click("#btn-ready");
  await waitFor(
    page,
    () => {
      const b = document.querySelector("#btn-find");
      return !!b && !b.disabled;
    },
    10000,
    "find match enabled",
  ).catch(async (e) => {
    const snap = await page.evaluate(() => {
      const party = document.querySelector("#party");
      return party ? party.textContent.replace(/\s+/g, " ").trim().slice(0, 200) : "NO #party";
    });
    console.error(`  (diagnostic) party screen at timeout: ${snap}`);
    throw e;
  });
}

async function waitGameBoots(page) {
  await waitFor(page, () => !!document.querySelector("#game-canvas"), 20000, "game canvas");
  await waitFor(page, () => !!document.querySelector("#loading"), 15000, "loading overlay");
  await waitFor(page, () => !document.querySelector("#loading"), 20000, "countdown -> playing");
  const webgl = await page.evaluate(() => {
    const cv = document.querySelector("#game-canvas");
    if (!cv) return "no-canvas";
    const gl = cv.getContext("webgl2") || cv.getContext("webgl");
    return gl ? "ok" : "no-webgl";
  });
  if (webgl !== "ok") throw new Error(webgl);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--window-size=1280,720",
    "--hide-scrollbars",
    "--mute-audio",
  ],
});

const failures = [];
let a, b;
try {
  a = await setupPage(browser);
  b = await setupPage(browser);
  console.log("A", 0, "guests created on both pages");

  await toPartyAndReady(a.page);
  await toPartyAndReady(b.page);
  console.log("A BOTH parties ready, finding match...");

  await Promise.all([a.page.click("#btn-find"), b.page.click("#btn-find")]);
  console.log("B FIND clicked on both");

  const before = Date.now();
  await Promise.all([waitGameBoots(a.page), waitGameBoots(b.page)]);
  console.log(`C both games booted to playing in ${((Date.now() - before) / 1000).toFixed(1)}s`);

  await sleep(1500); // let the render loop draw a bit
  for (const [name, p] of [
    ["A", a],
    ["B", b],
  ]) {
    const fatal = p.errs.filter((e) => !/favicon|ERR_|net::|Failed to load resource/.test(e));
    if (fatal.length) failures.push(`${name}: ${fatal.slice(0, 3).join(" | ")}`);
    console.log(`D ${name} errors: ${fatal.length ? fatal.join(" | ") : "none"}`);
  }

  await a.ctx.close();
  await b.ctx.close();
} catch (e) {
  failures.push("FLOW: " + e.message);
  console.error("E playtest error:", e.message);
  for (const [name, p] of [
    ["A", a],
    ["B", b],
  ]) {
    if (p?.errs?.length) console.error(`  ${name} captured:`, p.errs.slice(0, 6).join(" | "));
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nPLAYTEST FAILED:\n - " + failures.join("\n - "));
  process.exit(1);
}
console.log("\nPLAYTEST PASSED: 2 browsers created parties, matched 1v1, booted to playing with WebGL");
process.exit(0);