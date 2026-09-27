// End-to-end smoke test of the studio in a real browser (needs the server running: `npm start`).
// Usage: node qa/studio-smoke.mjs [--base=http://127.0.0.1:8787]
// Opens the sample deck, edits, switches theme, previews motion, presents and exports an HTML file.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = "1";
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
const base = args.base || "http://127.0.0.1:8787";
const outDir = join(root, "qa", "out");
await mkdir(outDir, { recursive: true });
const spki = process.env.PROXY_CA_SPKI || "";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined, args: spki ? [`--ignore-certificate-errors-spki-list=${spki}`] : [] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
const shot = async (name, target = page) => { const file = join(outDir, `studio-${name}.png`); await target.screenshot({ path: file }); console.log("saved", file); };
const step = async (label, fn) => { try { await fn(); console.log("ok  ", label); } catch (error) { errors.push(`${label}: ${error.message}`); console.log("FAIL", label, error.message); } };

await page.goto(base);
await page.evaluate(() => { localStorage.clear(); });
await page.goto(base);
await page.waitForTimeout(800);
await shot("create");

await step("open the sample deck", async () => {
  await page.click("#sampleDeckBtn");
  await page.waitForFunction(() => document.querySelectorAll(".film-item").length >= 40, null, { timeout: 20000 });
  await page.waitForFunction(() => !/チェック中/.test(document.getElementById("issueSummary").textContent), null, { timeout: 60000 });
  await page.waitForTimeout(600);
  console.log("     issue chip:", await page.textContent("#issueSummary"));
  await shot("edit");
});

await step("select a KPI slide and open the form", async () => {
  await page.click(".film-item:nth-child(5)");
  await page.click("#formTab");
  await page.waitForTimeout(400);
  await shot("inspector");
});

await step("inline edit the title", async () => {
  await page.click(".slide-wrap .hs-title");
  await page.keyboard.type("インライン編集のテスト");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const title = await page.textContent(".slide-wrap .hs-title");
  if (!title.includes("インライン編集のテスト")) throw new Error(`title not updated: ${title}`);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  console.log("     after undo:", await page.textContent(".slide-wrap .hs-title"));
});

await step("add a YouTube video by URL", async () => {
  await page.click('button:has-text("URL・YouTube")');
  await page.fill("#mediaUrlInput", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.click("#mediaUrlApply");
  await page.waitForSelector(".slide-wrap .hs-placed", { timeout: 5000 });
  await page.waitForTimeout(600);
  await shot("media");
  await page.keyboard.press("Control+z");
});

await step("grid and outline views", async () => {
  await page.click('label:has-text("一覧")');
  await page.waitForTimeout(800);
  await shot("grid");
  await page.click('label:has-text("構成")');
  await page.waitForTimeout(400);
  await shot("outline");
  await page.click('label:has-text("1枚")');
});

await step("design dialog + theme switch", async () => {
  await page.click("#designBtn");
  await page.waitForTimeout(1500);
  await shot("design");
  await page.click('.theme-card:has-text("ミッドナイト")');
  await page.waitForTimeout(600);
  await page.click('#designDialog .dialog-foot [data-close]');
  await page.waitForTimeout(800);
  await shot("midnight");
});

await step("motion preview", async () => {
  await page.click(".film-item:nth-child(22)");
  await page.click('button:has-text("▶ 動きを確認")');
  await page.waitForTimeout(2600);
  await shot("motion");
  await page.keyboard.press("Escape");
});

await step("present", async () => {
  await page.click(".film-item:nth-child(2)");
  await page.click("#presentBtn");
  await page.waitForSelector(".hs-player", { timeout: 10000 });
  await page.waitForTimeout(1600);
  await shot("present-1");
  for (let i = 0; i < 4; i += 1) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(700); }
  await shot("present-2");
  await page.click(".hs-player-stage [data-detail]").catch(() => {});
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
});

let exported = null;
await step("export HTML", async () => {
  const download = page.waitForEvent("download", { timeout: 60000 });
  await page.click("#downloadBtn");
  await page.waitForTimeout(800);
  if (await page.isVisible("#exportCheckDialog[open]")) {
    await shot("check");
    await page.click("#exportCheckGoBtn");
  }
  const file = await download;
  exported = join(outDir, "export.html");
  await file.saveAs(exported);
  console.log("     exported", exported);
});

if (exported) {
  await step("play the exported file", async () => {
    const view = await context.newPage();
    view.on("pageerror", (error) => errors.push(`export pageerror: ${error.message}`));
    await view.goto(pathToFileURL(exported).href);
    await view.waitForSelector(".hs-player .hs-slide", { timeout: 20000 });
    await view.waitForTimeout(1800);
    await shot("export-1", view);
    for (let i = 0; i < 6; i += 1) { await view.keyboard.press("ArrowRight"); await view.waitForTimeout(500); }
    await view.waitForTimeout(900);
    await shot("export-2", view);
    await view.close();
  });
}

await writeFile(join(outDir, "studio-errors.txt"), errors.join("\n"));
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no errors");
await browser.close();
