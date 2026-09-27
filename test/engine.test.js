import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { parseHTML } from "linkedom";

import { allLayoutSlides } from "./fixtures.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Load engine.js + motion.js into a DOM, exactly as a browser page (and an exported file) does. */
async function loadEngine() {
  const { window } = parseHTML("<!doctype html><html><head></head><body></body></html>");
  const icons = (await readFile(join(root, "public", "engine", "icons.json"), "utf8")).trim();
  const engine = (await readFile(join(root, "public", "engine", "engine.js"), "utf8")).replace("/*__ICONS__*/{}", () => icons);
  const motion = await readFile(join(root, "public", "engine", "motion.js"), "utf8");
  const context = vm.createContext(window);
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  vm.runInContext(engine, context, { filename: "engine.js" });
  vm.runInContext(motion, context, { filename: "motion.js" });
  return { E: window.SlideEngine, window };
}

const deckOf = (slides, extra = {}) => ({ title: "検証デッキ", audience: "役員", purpose: "意思決定", theme: "clarity", transition: "fade", motion: {}, slides, ...extra });

test("the engine renders every layout in every theme with editable, animatable parts", async () => {
  const { E } = await loadEngine();
  assert.equal(E.THEMES.length, 8);
  assert.equal(Object.keys(E.TYPE_LABELS).length, 42);
  const types = new Set(allLayoutSlides.map((slide) => slide.type));
  assert.equal(types.size, 42, "the fixture covers every layout");
  for (const theme of E.THEMES) {
    const deck = deckOf(allLayoutSlides, { theme: theme.id });
    deck.slides.forEach((slide, index) => {
      const el = E.render(slide, { deck, index, mode: "edit" });
      assert.ok(el.classList.contains("hs-slide"), `${theme.id} #${index + 1}`);
      assert.equal(el.dataset.theme, theme.id);
      assert.equal(el.dataset.type, slide.type);
      assert.ok(el.querySelector("[data-field]"), `${theme.id} ${slide.type}: nothing editable`);
      if (!["title", "section", "closing", "hero", "statement"].includes(slide.type)) {
        assert.ok(el.querySelector(".hs-title[data-field=title]"), `${slide.type}: title`);
        assert.match(el.querySelector(".hs-foot .hs-page").textContent, new RegExp(`${String(index + 1).padStart(2, "0")} / ${String(deck.slides.length).padStart(2, "0")}`));
      }
    });
  }
});

test("builds: steps appear on click, parallel items cascade, covers stay still", async () => {
  const { E } = await loadEngine();
  const deck = deckOf(allLayoutSlides);
  const byType = (type) => allLayoutSlides.findIndex((slide) => slide.type === type);
  const process = E.render(allLayoutSlides[byType("process")], { deck, index: byType("process"), mode: "present" });
  assert.equal(process.dataset.build, "click");
  assert.equal(Number(process.dataset.steps), 3, "one click per step");
  assert.equal(process.querySelectorAll("[data-g]").length >= 3, true);
  const cards = E.render(allLayoutSlides[byType("cards")], { deck, index: byType("cards"), mode: "present" });
  assert.equal(cards.dataset.build, "cascade");
  assert.equal(cards.dataset.steps, "0");
  const cover = E.render(allLayoutSlides[0], { deck, index: 0, mode: "present" });
  assert.equal(cover.dataset.build, "none");
  const forced = E.render({ ...allLayoutSlides[byType("cards")], animation: "click" }, { deck, index: 3, mode: "present" });
  assert.equal(Number(forced.dataset.steps), 3);
  E.play(process, { step: 0, animate: false });
  assert.equal(process.querySelectorAll("[data-g].hs-hidden").length, process.querySelectorAll("[data-g]").length, "nothing shown before the first click");
  E.reveal(process, 1);
  assert.equal(process.querySelectorAll('[data-g="0"].hs-hidden').length, 0);
});

test("numbers count up, charts are drawn as SVG and details get a badge", async () => {
  const { E } = await loadEngine();
  const sample = JSON.parse(await readFile(join(root, "public", "samples", "ai-rollout.json"), "utf8"));
  const deck = deckOf(sample.slideData);
  const kpiIndex = sample.slideData.findIndex((slide) => slide.type === "kpi" && slide.details?.length);
  const kpi = E.render(sample.slideData[kpiIndex], { deck, index: kpiIndex, mode: "present" });
  assert.ok(kpi.querySelector(".hs-count[data-count]"), "figures are marked for counting up");
  assert.ok(kpi.querySelector("[data-detail] .hs-detail-badge"), "a detail badge marks the clickable item");
  const chartIndex = sample.slideData.findIndex((slide) => slide.type === "imageText" && slide.image?.chartType === "bar");
  const chart = E.render(sample.slideData[chartIndex], { deck, index: chartIndex, mode: "present" });
  assert.ok(chart.querySelector("svg .hs-mark[data-tip]"), "bars carry a hover tooltip");
  assert.equal(E.numParts("1,440h").num, "1,440");
  assert.equal(E.numParts("4.3点").unit, "点");
});

test("photos and videos: slots, placement, YouTube and browser-kept files", async () => {
  const { E } = await loadEngine();
  const slides = [
    { type: "title", title: "表紙" },
    { type: "hero", title: "全面写真", visualAsset: "ai", photoMotion: "zoom" },
    { type: "cards", title: "動画付き", takeaway: "結論", items: [{ title: "A" }, { title: "B" }], media: { src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", kind: "video" } },
    { type: "content", title: "録画", takeaway: "結論", points: ["A"], media: { src: "idb:abc", kind: "video", autoplay: true, muted: true, placement: { x: 0.1, y: 0.2, w: 0.3, h: 0.3 } } },
    { type: "closing", message: "以上" },
  ];
  const deck = deckOf(slides);
  const hero = E.render(slides[1], { deck, index: 1, mode: "present", assetBase: "/assets/" });
  assert.equal(hero.querySelector(".hs-media").dataset.motion, "zoom");
  assert.match(hero.querySelector(".hs-media img").getAttribute("src"), /\/assets\/ai-executive-hero\.jpg$/);
  const exported = E.render(slides[1], { deck, index: 1, mode: "present", assetMap: { "ai-executive-hero.jpg": "data:image/jpeg;base64,AAAA" } });
  assert.equal(exported.querySelector(".hs-media img").getAttribute("src"), "data:image/jpeg;base64,AAAA", "exports carry their photos");
  const youtubeLive = E.render(slides[2], { deck, index: 2, mode: "present" });
  assert.match(youtubeLive.querySelector(".hs-placed iframe").getAttribute("src"), /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  const youtubeEdit = E.render(slides[2], { deck, index: 2, mode: "edit" });
  assert.equal(youtubeEdit.querySelector("iframe"), null, "the editor shows a still picture, not a player");
  const video = E.render(slides[3], { deck, index: 3, mode: "present", mediaUrls: { "idb:abc": "blob:video" } });
  const placed = video.querySelector(".hs-placed");
  assert.equal(placed.style.left, "10%");
  assert.equal(placed.querySelector("video").getAttribute("src"), "blob:video");
  assert.ok(placed.querySelector("video").hasAttribute("data-autoplay"));
  assert.equal(E.youtubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("deck-wide design: accent colour, motion switches and theme fonts", async () => {
  const { E } = await loadEngine();
  const deck = deckOf(allLayoutSlides.slice(0, 3), { theme: "editorial", accent: "#123456", motion: { entrance: "blur", hover: "focus", numbers: false, ambient: false } });
  const el = E.render(deck.slides[2], { deck, index: 2, mode: "present" });
  assert.equal(el.style.getPropertyValue("--accent"), "#123456");
  assert.equal(el.dataset.entrance, "blur");
  assert.equal(el.dataset.hover, "focus");
  assert.equal(el.dataset.ambient, "off");
  assert.ok(!el.classList.contains("hs-numbers"));
  assert.match(E.fontHref(["editorial"]), /^https:\/\/fonts\.googleapis\.com\/css2\?family=Shippori\+Mincho\+B1/);
  const fitted = E.render(deck.slides[2], { deck, index: 2, mode: "thumb", fit: { fs: 0.85, ts: 0.9 } });
  assert.equal(fitted.style.getPropertyValue("--fs"), "0.85");
  assert.ok(fitted.classList.contains("hs-static"), "thumbnails never animate");
});
