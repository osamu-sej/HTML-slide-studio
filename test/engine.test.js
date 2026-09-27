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
  // YouTube refuses to play (error 153) unless the player is told which site embeds it.
  assert.equal(youtubeLive.querySelector(".hs-placed iframe").getAttribute("referrerpolicy"), "strict-origin-when-cross-origin");
  const youtubeEdit = E.render(slides[2], { deck, index: 2, mode: "edit" });
  assert.equal(youtubeEdit.querySelector("iframe"), null, "the editor shows a still picture, not a player");
  const video = E.render(slides[3], { deck, index: 3, mode: "present", mediaUrls: { "idb:abc": "blob:video" } });
  const placed = video.querySelector(".hs-placed");
  assert.equal(placed.style.left, "10%");
  assert.equal(placed.querySelector("video").getAttribute("src"), "blob:video");
  assert.ok(placed.querySelector("video").hasAttribute("data-autoplay"));
  assert.equal(E.youtubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("motion graphics: kinetic type and backdrops by default, per deck and per slide", async () => {
  const { E } = await loadEngine();
  const slides = [
    { type: "title", title: "表紙" },
    { type: "section", title: "章" },
    { type: "content", title: "本文", takeaway: "結論", points: ["A", "B"] },
    { type: "hero", title: "全面写真", visualAsset: "ai" },
    { type: "closing", message: "以上" },
  ];
  const plain = deckOf(slides);
  const cover = E.render(slides[0], { deck: plain, index: 0, mode: "present" });
  assert.equal(cover.dataset.kinetic, "mask", "big lines move by default");
  assert.equal(cover.dataset.backdrop, undefined, "no backdrop unless chosen");
  assert.ok(cover.querySelector(".hs-cover-art"), "the theme's cover art stays");
  assert.equal(cover.dataset.draw, "on");
  assert.equal(E.render(slides[2], { deck: plain, index: 2, mode: "present" }).dataset.kinetic, undefined, "body slides keep their titles still");

  const moving = deckOf(slides, { motion: { kinetic: "type", backdrop: "orbits", draw: false } });
  const title = E.render(slides[0], { deck: moving, index: 0, mode: "present" });
  assert.equal(title.dataset.kinetic, "type");
  assert.ok(title.querySelector('.hs-decor .hs-bd[data-bd="orbits"] .hs-bd-sat'), "satellites on their orbits");
  assert.equal(title.querySelector(".hs-cover-art"), null, "the backdrop replaces the cover art");
  assert.equal(title.dataset.draw, "off");
  assert.equal(E.render(slides[1], { deck: moving, index: 1, mode: "present" }).dataset.backdrop, "orbits");
  assert.equal(E.render(slides[2], { deck: moving, index: 2, mode: "present" }).dataset.backdrop, undefined, "the deck's backdrop stays on stage slides");
  assert.equal(E.render(slides[3], { deck: moving, index: 3, mode: "present" }).dataset.backdrop, undefined, "a full-bleed photo is its own backdrop");

  const own = E.render({ ...slides[2], kinetic: "chars", backdrop: "waves" }, { deck: moving, index: 2, mode: "present" });
  assert.equal(own.dataset.kinetic, "chars");
  assert.equal(own.dataset.backdrop, "waves");
  const off = E.render({ ...slides[1], kinetic: "none", backdrop: "none" }, { deck: moving, index: 1, mode: "present" });
  assert.equal(off.dataset.kinetic, undefined);
  assert.equal(off.querySelector(".hs-bd"), null);

  for (const kind of Object.keys(E.BACKDROPS)) {
    const a = E.render({ ...slides[1], backdrop: kind }, { deck: plain, index: 1, mode: "thumb" });
    const b = E.render({ ...slides[1], backdrop: kind }, { deck: plain, index: 1, mode: "present" });
    assert.ok(a.querySelector(`.hs-bd[data-bd="${kind}"]`).children.length > 0, `${kind} draws something`);
    assert.equal(a.querySelector(".hs-bd").outerHTML, b.querySelector(".hs-bd").outerHTML, `${kind}: thumbnails match the presentation`);
  }
  const icon = E.render({ type: "cards", title: "t", takeaway: "k", items: [{ title: "A", icon: "rocket" }] }, { deck: plain, index: 2, mode: "present" }).querySelector(".hs-icon");
  assert.ok([...icon.children].every((shape) => shape.getAttribute("pathLength") === "1"), "icon strokes can draw themselves");
});

test("kinetic type splits the big lines without changing their text or line-break rules", async () => {
  const { E } = await loadEngine();
  const slide = { type: "statement", title: "目指すこと", text: "毎月**1,440時間**を、考える仕事へ。AI活用" };
  const deck = deckOf([{ type: "title", title: "t" }, slide, { type: "closing" }]);
  for (const mode of ["mask", "words", "chars", "type"]) {
    const el = E.render({ ...slide, kinetic: mode }, { deck, index: 1, mode: "present" });
    const text = el.querySelector(".hs-statement-text");
    const before = text.textContent;
    E.play(el);
    const units = [...text.querySelectorAll(".hs-k")];
    assert.ok(text.classList.contains("hs-kin"), mode);
    assert.equal(text.textContent, before, `${mode}: the words stay the same`);
    assert.ok(units.length > 3, `${mode}: split into units`);
    assert.ok(!units.some((unit) => /^[、。]/.test(unit.textContent)), `${mode}: no unit starts with 、 or 。`);
    assert.ok(text.querySelector(".hs-em .hs-k"), `${mode}: the emphasis keeps its marker`);
    assert.match(text.style.getPropertyValue("--kst"), /^\d+ms$/);
    assert.equal(units.at(-1).classList.contains("hs-k-last"), true);
    if (mode === "mask") assert.ok(text.querySelector(".hs-km > .hs-k"), "mask: each unit rises from behind its own edge");
    if (mode === "chars") assert.deepEqual([...text.querySelectorAll(".hs-kw")].map((word) => word.textContent), ["1,440", "AI"], "chars: Latin words and figures do not break");
    E.play(el);
    assert.equal(text.querySelectorAll(".hs-k").length, units.length, `${mode}: playing again does not split twice`);
  }
});

test("Lottie animations: a player box when shown, a badge in thumbnails", async () => {
  const { E } = await loadEngine();
  const slides = [
    { type: "title", title: "表紙" },
    { type: "cards", title: "動き", takeaway: "結論", items: [{ title: "A" }], media: { src: "idb:lot", kind: "lottie", name: "rocket.json", placement: { x: 0.5, y: 0.2, w: 0.3, h: 0.4 } } },
    { type: "closing" },
  ];
  const deck = deckOf(slides);
  const desc = E.mediaOf(slides[1]);
  assert.equal(desc.kind, "lottie");
  assert.equal(desc.fit, "contain", "animations are shown whole by default");
  assert.equal(E.mediaOf({ media: { src: "https://lottie.host/a/b.json" } }).kind, "lottie");
  const live = E.render(slides[1], { deck, index: 1, mode: "present", mediaUrls: { "idb:lot": "blob:lottie" } });
  const host = live.querySelector(".hs-placed.hs-lottie .hs-lottie-host");
  assert.equal(host.dataset.src, "blob:lottie");
  assert.ok(host.hasAttribute("data-autoplay") && host.hasAttribute("data-loop"));
  const thumb = E.render(slides[1], { deck, index: 1, mode: "thumb", mediaUrls: { "idb:lot": "blob:lottie" } });
  assert.equal(thumb.querySelector(".hs-lottie-host"), null);
  assert.match(thumb.querySelector(".hs-lottie-badge").textContent, /rocket/);
  assert.equal(typeof E.mountLottie, "function");
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

test("deep-dive pages: outside the story, numbered by their slide, opened from an item with an arrow", async () => {
  const { E } = await loadEngine();
  const slides = [
    { type: "title", title: "表紙" },
    { type: "stepUp", title: "発展段階", takeaway: "役割を広げてきた", items: [{ title: "規則", desc: "a" }, { title: "学習", desc: "b" }, { title: "生成", desc: "c" }], details: [{ target: "items[1]", text: "補足" }, { target: "items[2]", text: "生成の補足" }] },
    { type: "content", title: "学習の仕組み", takeaway: "例から傾向をつかむ", points: ["背景", "具体例"], drillOf: "items[1]" },
    { type: "cards", title: "選び方", takeaway: "3つの軸", items: [{ title: "用途" }, { title: "品質" }] },
    { type: "closing", message: "以上" },
  ];
  // The engine runs in its own context: compare plain copies of what it returns.
  const story = JSON.parse(JSON.stringify(E.storyMap(slides)));
  assert.deepEqual(story.order, [0, 1, 3, 4]);
  assert.deepEqual(story.parent, { 2: 1 });
  assert.deepEqual(story.drills[1], [{ index: 2, target: "items[1]" }]);
  assert.deepEqual([story.no[1], story.no[2], story.no[3]], [2, 2, 3]);
  assert.deepEqual([...E.storyMap([{ type: "title", drillOf: "items[0]" }, { type: "closing" }]).order], [0, 1], "the cover is never a deep-dive page");

  const deck = deckOf(slides);
  const parent = E.render(slides[1], { deck, index: 1, mode: "present" });
  assert.equal(parent.querySelector(".hs-page").textContent, "02 / 04", "numbers count the story only");
  const opener = [...parent.querySelectorAll('[data-item="items[1]"]')].find((el) => el.dataset.drill);
  assert.equal(opener?.dataset.drill, "2");
  assert.equal(parent.querySelectorAll(".hs-drill-badge").length, 1);
  assert.equal(parent.querySelector('[data-item="items[1]"] .hs-detail-badge'), null, "the arrow replaces the details mark on that item");
  assert.ok(parent.querySelector('[data-item="items[2]"] .hs-detail-badge'), "other items keep their details");

  const page = E.render(slides[2], { deck, index: 2, mode: "present" });
  assert.ok(page.classList.contains("hs-drill"));
  assert.equal(page.dataset.drillOf, "1");
  assert.equal(page.querySelector(".hs-page").textContent, "02 ・ 深掘り");
  assert.match(page.querySelector(".hs-eyebrow").textContent, /↳ 発展段階/);
  assert.equal(page.querySelectorAll("[data-drill]").length, 0, "one level: a deep-dive page opens nothing further");
  assert.equal(E.render(slides[3], { deck, index: 3, mode: "thumb" }).querySelector(".hs-page").textContent, "03 / 04");
});
