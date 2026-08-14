const BASE = process.env.TWINKLE_URL || "http://127.0.0.1:8795";
import { chromium } from "playwright";

// The twinkle-twinkle concept carries its own copy of the shift model, because
// each concept stays dependency-free enough to open straight off disk. That
// makes drift the risk, so this suite re-checks the same invariants the retro
// terminal is held to, plus the theme's own behaviour.

const URL = `${BASE}/index.html`;
const browser = await chromium.launch();
let pass = 0, fail = 0;

function check(label, actual, expected) {
  const ok = typeof expected === "function" ? expected(actual) : actual === expected;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got: ${JSON.stringify(actual)}`}`);
  ok ? pass++ : fail++;
}

const at = (h, m, s = 0, ms = 0, day = 10) => new Date(2026, 7, day, h, m, s, ms);
const utc = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo, d, h, mi, 0));

async function snap({ when, start = "09:00", end = "18:00", tz, advance = 120, viewport }) {
  const ctx = await browser.newContext({ ...(tz ? { timezoneId: tz } : {}), ...(viewport ? { viewport } : {}) });
  await ctx.addInitScript(([s, e]) => {
    localStorage.setItem("workday-start", s);
    localStorage.setItem("workday-end", e);
  }, [start, end]);
  const page = await ctx.newPage();
  await page.clock.install({ time: when });
  await page.goto(URL);
  await page.clock.runFor(advance);
  const out = await page.evaluate(() => ({
    percent: document.querySelector("#percent").textContent,
    title: document.querySelector("#title-text").textContent,
    note: document.querySelector("#end-note").textContent,
    mood: document.querySelector("#star").dataset.mood,
    worked: document.querySelector("#worked").textContent,
    remaining: document.querySelector("#remaining").textContent,
    duration: document.querySelector("#duration").textContent,
    tray: document.querySelectorAll(".tray span.on").length,
    complete: document.body.classList.contains("complete"),
    errShown: !document.querySelector("#error").hidden,
    errText: document.querySelector("#error").textContent,
    warnShown: !document.querySelector("#warning").hidden,
    startVal: document.querySelector("#start-time").value,
    valueNow: document.querySelector("#progress-track").getAttribute("aria-valuenow"),
  }));
  await ctx.close();
  return out;
}

console.log("\n=== Nothing may read 100 before the shift genuinely ends ===");
for (const [h, m, s] of [[17, 49, 0], [17, 59, 29], [17, 59, 59]]) {
  const r = await snap({ when: at(h, m, s) });
  const t = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  check(`${t} percent < 100 (${r.percent})`, r.percent, (p) => p !== "100.0000%" && /^99?\.?/.test(p));
  check(`${t} not marked complete`, r.complete, false);
  check(`${t} fewer than 10 tray stars (${r.tray})`, r.tray, (v) => v < 10);
}
const done = await snap({ when: at(18, 0, 0) });
check(`18:00:00 reads exactly 100.0000% (${done.percent})`, done.percent, "100.0000%");
check("18:00:00 marked complete", done.complete, true);
check("18:00:00 all 10 tray stars lit", done.tray, 10);
check("18:00:00 star is happy", done.mood, "happy");

console.log("\n=== Floors rather than rounds ===");
const almost = await snap({ when: at(17, 59, 59) });
check(`17:59:59 shows 99.xxxx%, never 100 (${almost.percent})`, almost.percent, (p) => /^99\.\d{4}%$/.test(p));

console.log("\n=== Overnight shift and its completed-state grace window ===");
for (const [h, m] of [[6, 0], [9, 0], [11, 59]]) {
  const r = await snap({ when: at(h, m), start: "22:00", end: "06:00" });
  check(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} still shows the finished shift`, r.complete, true);
}
const expired = await snap({ when: at(12, 30), start: "22:00", end: "06:00" });
check("12:30 grace expired -> back to not started", expired.mood, "asleep");
const mid = await snap({ when: at(2, 0), start: "22:00", end: "06:00" });
check(`02:00 mid-shift, running (${mid.percent})`, mid.complete, false);

console.log("\n=== Daylight saving (America/New_York, forward 8 Mar 2026) ===");
const gap = await snap({ when: utc(2026, 2, 8, 7, 15), start: "02:30", end: "03:30", tz: "America/New_York" });
check("a time inside the skipped hour is reported, not silently moved", gap.errShown, true);
check("…and no NaN leaks into the percentage", gap.percent, (p) => !p.includes("NaN"));
const grace = await snap({ when: utc(2026, 2, 7, 7, 45), start: "18:00", end: "02:30", tz: "America/New_York" });
check("overnight grace does not inherit tomorrow's DST shift", grace.complete, true);
check("…and reports the real 2:30 end", grace.note, (n) => n.includes("2:30") && !n.includes("3:30"));

console.log("\n=== Long-shift warning uses the entered span, not elapsed time ===");
const fn = await snap({ when: utc(2026, 2, 7, 17, 0), start: "10:00", end: "03:00", tz: "America/New_York" });
check("17h typed over a spring-forward night still warns", fn.warnShown, true);
const fp = await snap({ when: utc(2026, 9, 31, 16, 0), start: "10:00", end: "02:00", tz: "America/New_York" });
check("16h typed over a fall-back night does not warn", fp.warnShown, false);
const plain = await snap({ when: at(13, 30) });
check("ordinary 9h shift does not warn", plain.warnShown, false);

console.log("\n=== Worked + left always equals the whole shift ===");
for (const [h, m, s] of [[9, 17, 0], [13, 30, 30], [16, 42, 8]]) {
  const r = await snap({ when: at(h, m, s) });
  const toMin = (v) => { const x = v.match(/(\d+)h (\d+)m/); return +x[1] * 60 + +x[2]; };
  check(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${r.worked} + ${r.remaining} = ${r.duration}`,
    toMin(r.worked) + toMin(r.remaining), toMin(r.duration));
}

console.log("\n=== Stored values the time control would reject ===");
const corrupt = await snap({ when: at(13, 30), start: "9am" });
check("'9am' falls back to 09:00", corrupt.startVal, "09:00");
check("'9am' does not leave the page in an error state", corrupt.errShown, false);
const secs = await snap({ when: at(13, 30), start: "09:00:30" });
check("'09:00:30' falls back to 09:00", secs.startVal, "09:00");

console.log("\n=== Validation messages ===");
const same = await snap({ when: at(13, 30), start: "09:00", end: "09:00" });
check("identical times are rejected", same.errShown, true);
check("…with a message that says so", same.errText, (t) => t.includes("same time"));

console.log("\n=== Star mood tracks the shift ===");
check("before clock-in the star is asleep", (await snap({ when: at(7, 0) })).mood, "asleep");
check("early in the shift it is sleepy", (await snap({ when: at(11, 30) })).mood, "sleepy");
check("past half way it is awake", (await snap({ when: at(16, 0) })).mood, "awake");

console.log("\n=== Page fits without horizontal overflow ===");
for (const [w, h] of [[1440, 900], [1280, 720], [390, 844], [320, 700]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.clock.install({ time: at(13, 30) });
  await page.goto(URL);
  await page.clock.runFor(120);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${w}x${h} no horizontal overflow (${over}px)`, over, (v) => v <= 0);
  await ctx.close();
}

console.log("\n=== The fast percentage ticker must not outrun the rest of the page ===");
{
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem("workday-start", "09:00");
    localStorage.setItem("workday-end", "18:00");
  });
  const page = await ctx.newPage();
  // Load off the whole second: the 1Hz loop's phase is fixed at load and has
  // nothing to do with when the shift ends.
  await page.clock.install({ time: at(17, 59, 58, 900) });
  await page.goto(URL);
  await page.clock.runFor(20);
  let desyncMs = 0;
  for (let i = 0; i < 90; i++) {
    await page.clock.runFor(20);
    const s = await page.evaluate(() => ({
      pct: document.querySelector("#percent").textContent,
      complete: document.body.classList.contains("complete"),
    }));
    if (s.pct === "100.0000%" && !s.complete) desyncMs += 20;
  }
  check(`percent never reads 100 before the page completes (${desyncMs}ms)`, desyncMs, 0);
  const end = await page.evaluate(() => ({
    complete: document.body.classList.contains("complete"),
    mood: document.querySelector("#star").dataset.mood,
  }));
  check("…and the shift does complete", end.complete, true);
  check("…with the star awake and happy", end.mood, "happy");
  await ctx.close();
}

console.log("\n=== Decoration must never take the page down ===");
{
  // A renamed selector once made the sky seeder throw, which killed the whole
  // script before a single number was drawn. Nothing rendered, and every
  // behavioural assertion above would still have looked fine in isolation.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: at(13, 30) });
  await page.goto(URL);
  await page.clock.runFor(150);
  check("no uncaught page errors on load", errors, (e) => e.length === 0);
  const live = await page.evaluate(() => ({
    seeded: document.querySelectorAll("#starfield i").length,
    percent: document.querySelector("#percent").textContent,
  }));
  check(`the sky actually got seeded (${live.seeded} stars)`, live.seeded, (n) => n > 20);
  check("…and the clock still rendered", live.percent, (p) => /^\d/.test(p));
  await ctx.close();
}

console.log("\n=== Sky characters follow the shift ===");
async function skyAt(when) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem("workday-start", "09:00");
    localStorage.setItem("workday-end", "18:00");
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: when });
  await page.goto(URL);
  await page.clock.runFor(150);
  await page.waitForTimeout(1800); // let the moon/sun cross-fade finish
  const out = await page.evaluate(() => ({
    moon: +getComputedStyle(document.querySelector(".moon")).opacity,
    sun: +getComputedStyle(document.querySelector(".sun")).opacity,
    diamond: document.querySelector("#diamond").classList.contains("show"),
  }));
  await ctx.close();
  return out;
}
const night = await skyAt(at(13, 30));
check(`mid-shift the moon is out (${night.moon})`, night.moon, (v) => v > 0.8);
check(`mid-shift the sun is not (${night.sun})`, night.sun, (v) => v < 0.05);
check("mid-shift no diamond yet", night.diamond, false);
const gem = await skyAt(at(16, 30));
check("past 75% the diamond appears", gem.diamond, true);
const dawn = await skyAt(at(18, 5));
check(`at knock-off the moon has set (${dawn.moon})`, dawn.moon, (v) => v < 0.05);
check(`…and the sun is up (${dawn.sun})`, dawn.sun, (v) => v > 0.8);

console.log("\n=== prefers-reduced-motion turns the motion off without hiding things ===");
{
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    localStorage.setItem("workday-start", "09:00");
    localStorage.setItem("workday-end", "18:00");
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: at(18, 5) });
  await page.goto(URL);
  await page.clock.runFor(150);
  const r = await page.evaluate(() => {
    const opacityOf = (sel) => +getComputedStyle(document.querySelector(sel)).opacity;
    return {
      running: document.getAnimations().filter((a) => a.playState === "running").length,
      // These are invisible by default and revealed by their animation, so a
      // blanket `animation: none` would erase them entirely.
      zzz: opacityOf(".zzz text"),
      friend: opacityOf(".companions span"),
      sparkle: opacityOf(".sparkles span"),
      confetti: getComputedStyle(document.querySelector(".confetti")).display,
      percent: document.querySelector("#percent").textContent,
    };
  });
  check(`no animations left running (${r.running})`, r.running, 0);
  check(`the sleeping z stays visible (${r.zzz})`, r.zzz, (v) => v > 0.1);
  check(`companion stars stay visible (${r.friend})`, r.friend, (v) => v > 0.1);
  check(`completion sparkles stay visible (${r.sparkle})`, r.sparkle, (v) => v > 0.1);
  check("confetti is dropped rather than frozen mid-air", r.confetti, "none");
  check("and the page still works", r.percent, "100.0000%");
  await ctx.close();
}

console.log(`\n${fail === 0 ? "ALL GREEN" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
