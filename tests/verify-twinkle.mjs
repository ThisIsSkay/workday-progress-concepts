const BASE = process.env.TWINKLE_URL || "http://127.0.0.1:8795";
import { chromium } from "playwright";

// The courier-cat concept carries its own copy of the shift model, because each
// concept stays dependency-free enough to open straight off disk. That makes
// drift the risk, so this suite re-checks the same invariants the retro
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

async function snap({ when, start = "09:00", end = "18:00", tz, advance = 150, viewport }) {
  const ctx = await browser.newContext({ ...(tz ? { timezoneId: tz } : {}), ...(viewport ? { viewport } : {}) });
  await ctx.addInitScript(([s, e]) => {
    localStorage.setItem("workday-start", s);
    localStorage.setItem("workday-end", e);
  }, [start, end]);
  const page = await ctx.newPage();
  await page.clock.install({ time: when });
  await page.goto(URL);
  await page.clock.runFor(advance);
  const out = await page.evaluate(() => {
    const rider = document.querySelector("#rider");
    const scene = document.querySelector("#scene");
    return {
      percent: document.querySelector("#percent").textContent,
      title: document.querySelector("#title-text").textContent,
      note: document.querySelector("#end-note").textContent,
      mood: rider.dataset.mood,
      p: parseFloat(getComputedStyle(scene).getPropertyValue("--p")),
      riderLeft: rider.getBoundingClientRect().left + rider.getBoundingClientRect().width / 2,
      sceneLeft: scene.getBoundingClientRect().left,
      sceneWidth: scene.getBoundingClientRect().width,
      passed: document.querySelectorAll(".cp.passed").length,
      worked: document.querySelector("#worked").textContent,
      remaining: document.querySelector("#remaining").textContent,
      duration: document.querySelector("#duration").textContent,
      complete: document.body.classList.contains("complete"),
      errShown: !document.querySelector("#error").hidden,
      errText: document.querySelector("#error").textContent,
      warnShown: !document.querySelector("#warning").hidden,
      startVal: document.querySelector("#start-time").value,
    };
  });
  await ctx.close();
  return out;
}

console.log("\n=== Nothing may read 100 before the shift genuinely ends ===");
for (const [h, m, s] of [[17, 49, 0], [17, 59, 29], [17, 59, 59]]) {
  const r = await snap({ when: at(h, m, s) });
  const t = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  check(`${t} percent < 100 (${r.percent})`, r.percent, (p) => p !== "100.0000%");
  check(`${t} not marked complete`, r.complete, false);
}
const done = await snap({ when: at(18, 0, 0) });
check(`18:00:00 reads exactly 100.0000% (${done.percent})`, done.percent, "100.0000%");
check("18:00:00 marked complete", done.complete, true);
check("18:00:00 every checkpoint is behind us", done.passed, 3);
check("18:00:00 the cat is home", done.mood, "done");

console.log("\n=== Floors rather than rounds ===");
const almost = await snap({ when: at(17, 59, 59) });
check(`17:59:59 shows 99.xxxx%, never 100 (${almost.percent})`, almost.percent, (p) => /^99\.\d{4}%$/.test(p));

console.log("\n=== The rider's position along the road IS the progress ===");
for (const [h, m, want] of [[9, 0, 0], [11, 15, 25], [13, 30, 50], [15, 45, 75], [18, 0, 100]]) {
  const r = await snap({ when: at(h, m) });
  check(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} scene --p tracks the percentage (${r.p.toFixed(1)})`,
    Math.abs(r.p - want), (d) => d < 0.2);
  // The rider must sit inside the scene at every point, never clipped off an edge.
  const frac = (r.riderLeft - r.sceneLeft) / r.sceneWidth;
  check(`  …and the cat is on screen (${(frac * 100).toFixed(0)}% across)`, frac, (f) => f > 0.02 && f < 0.98);
}
const start = await snap({ when: at(9, 0) });
const finish = await snap({ when: at(18, 0) });
check("the cat actually travels left to right", finish.riderLeft - start.riderLeft, (d) => d > 100);

console.log("\n=== Checkpoints are cleared as they are passed ===");
for (const [h, m, want] of [[9, 30, 0], [11, 30, 1], [13, 45, 2], [16, 0, 3]]) {
  const r = await snap({ when: at(h, m) });
  check(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} -> ${want} checkpoint(s) passed`, r.passed, want);
}

console.log("\n=== Face changes through the route, including before a checkpoint ===");
check("before clock-in the cat is resting", (await snap({ when: at(7, 0) })).mood, "resting");
check("just after setting off it is eager", (await snap({ when: at(9, 30) })).mood, "eager");
check("settled into the ride it is focused", (await snap({ when: at(13, 0) })).mood, "focused");
check("past half way it is tired", (await snap({ when: at(14, 30) })).mood, "tired");
check("on the last stretch it gets a second wind", (await snap({ when: at(16, 45) })).mood, "secondwind");
// The anticipation beat: it should spot a checkpoint BEFORE reaching it.
const nearly25 = await snap({ when: at(11, 5) });
check(`approaching 25% it spots the checkpoint (${nearly25.p.toFixed(1)}%)`, nearly25.mood, "spotting");
const nearly50 = await snap({ when: at(13, 20) });
check(`approaching 50% it spots the checkpoint (${nearly50.p.toFixed(1)}%)`, nearly50.mood, "spotting");
const nearly75 = await snap({ when: at(15, 35) });
check(`approaching 75% it spots the checkpoint (${nearly75.p.toFixed(1)}%)`, nearly75.mood, "spotting");
const wellClear = await snap({ when: at(12, 0) });
check(`well clear of a checkpoint it is not spotting (${wellClear.p.toFixed(1)}%)`, wellClear.mood, (m) => m !== "spotting");

console.log("\n=== Overnight shift and its completed-state grace window ===");
for (const [h, m] of [[6, 0], [9, 0], [11, 59]]) {
  const r = await snap({ when: at(h, m), start: "22:00", end: "06:00" });
  check(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} still shows the finished shift`, r.complete, true);
}
const expired = await snap({ when: at(12, 30), start: "22:00", end: "06:00" });
check("12:30 grace expired -> back to not started", expired.mood, "resting");
const mid = await snap({ when: at(2, 0), start: "22:00", end: "06:00" });
check(`02:00 mid-shift, still riding (${mid.percent})`, mid.complete, false);

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
check("ordinary 9h shift does not warn", (await snap({ when: at(13, 30) })).warnShown, false);

console.log("\n=== Ridden + to go always equals the whole route ===");
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
check("'09:00:30' falls back to 09:00", (await snap({ when: at(13, 30), start: "09:00:30" })).startVal, "09:00");

console.log("\n=== Validation messages ===");
const same = await snap({ when: at(13, 30), start: "09:00", end: "09:00" });
check("identical times are rejected", same.errShown, true);
check("…with a message that says so", same.errText, (t) => t.includes("same time"));

console.log("\n=== Every mood shows exactly one pair of eyes and one mouth ===");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForTimeout(300);
  // Stop the page's loops, or update() reasserts the real mood mid-check.
  await page.evaluate(() => { for (let i = 1; i < 9999; i++) clearInterval(i); });
  for (const mood of ["resting", "eager", "focused", "spotting", "tired", "secondwind", "done"]) {
    const shown = await page.evaluate((m) => {
      document.querySelector("#rider").dataset.mood = m;
      const vis = (c) => getComputedStyle(document.querySelector(`.${c}`)).display !== "none";
      return {
        eyes: ["eyes-open", "eyes-squint", "eyes-strain", "eyes-happy", "eyes-sparkle"].filter(vis),
        mouth: ["mouth-flat", "mouth-pant", "mouth-grin"].filter(vis),
      };
    }, mood);
    check(`${mood.padEnd(11)} -> ${shown.eyes[0] || "none"} + ${shown.mouth[0] || "none"}`,
      shown.eyes.length === 1 && shown.mouth.length === 1, true);
  }
  await ctx.close();
}

console.log("\n=== Decoration must never take the page down ===");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: at(13, 30) });
  await page.goto(URL);
  await page.clock.runFor(150);
  check("no uncaught page errors on load", errors, (e) => e.length === 0);
  const live = await page.evaluate(() => document.querySelector("#percent").textContent);
  check("…and the clock rendered", live, (p) => /^\d/.test(p));
  await ctx.close();
}

console.log("\n=== Fits every viewport without sideways scroll ===");
for (const [w, h] of [[1440, 900], [1280, 720], [390, 844], [320, 700]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.clock.install({ time: at(13, 30) });
  await page.goto(URL);
  await page.clock.runFor(150);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${w}x${h} no horizontal overflow (${over}px)`, over, (v) => v <= 0);
  await ctx.close();
}

console.log("\n=== prefers-reduced-motion turns the motion off ===");
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
  const r = await page.evaluate(() => ({
    // Only CSS animations: getAnimations() also returns transient CSSTransition
    // objects from state changes JS applies on load, which come and go and made
    // this assertion flaky. Transitions are disabled here too, via CSS.
    running: document.getAnimations()
      .filter((a) => a.playState === "running" && a.animationName !== undefined).length,
    transitions: document.getAnimations().filter((a) => a.transitionProperty !== undefined).length,
    // Effort puffs and speed lines only exist as motion; frozen they read as debris.
    puff: getComputedStyle(document.querySelector(".puff")).display,
    speed: getComputedStyle(document.querySelector(".speedlines")).display,
    riderVisible: +getComputedStyle(document.querySelector("#rider")).opacity,
    percent: document.querySelector("#percent").textContent,
  }));
  check(`no CSS animations left running (${r.running})`, r.running, 0);
  check(`and no transitions gliding either (${r.transitions})`, r.transitions, 0);
  check("effort puffs are dropped rather than frozen", r.puff, "none");
  check("speed lines are dropped rather than frozen", r.speed, "none");
  check("the cat is still visible", r.riderVisible, (v) => v > 0.9);
  check("and the page still works", r.percent, "100.0000%");
  await ctx.close();
}

console.log(`\n${fail === 0 ? "ALL GREEN" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
