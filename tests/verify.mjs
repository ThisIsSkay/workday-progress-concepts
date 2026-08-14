const BASE = process.env.BASE_URL || "http://127.0.0.1:8781";
import { chromium } from "playwright";

const URL = `${BASE}/index.html`;
const browser = await chromium.launch();
let pass = 0, fail = 0;

async function snap(when, start, end, advanceMs = 100) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(([s, e]) => {
    localStorage.setItem("workday-start", s);
    localStorage.setItem("workday-end", e);
  }, [start, end]);
  const page = await ctx.newPage();
  await page.clock.install({ time: when });
  await page.goto(URL);
  await page.clock.runFor(advanceMs);
  const out = await page.evaluate(() => ({
    title: document.querySelector("#title-text").textContent,
    percent: document.querySelector("#percent").textContent,
    count: document.querySelector("#progress-count").textContent,
    bar: document.querySelector("#ascii-bar").textContent,
    note: document.querySelector("#end-note").textContent,
    errShown: !document.querySelector("#error").hidden,
    errText: document.querySelector("#error").textContent,
    zoom: document.querySelector(".crt").style.zoom,
  }));
  await ctx.close();
  return out;
}

function check(label, actual, expected) {
  const ok = typeof expected === "function" ? expected(actual) : actual === expected;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got: ${JSON.stringify(actual)}`}`);
  ok ? pass++ : fail++;
}

const at = (h, m, s = 0, day = 10) => new Date(2026, 7, day, h, m, s);

console.log("\n=== BUG 1: overnight 22:00->06:00, log-off screen must survive the end of the shift ===");
for (const [h, m] of [[6, 0], [6, 1], [9, 0], [11, 59]]) {
  const r = await snap(at(h, m), "22:00", "06:00");
  check(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} -> YOU MAY LOG OFF NOW  (${r.percent})`, r.title, "YOU MAY LOG OFF NOW");
}
const after = await snap(at(12, 30), "22:00", "06:00");
check("12:30 -> grace expired, back to NOT ON THE CLOCK YET", after.title, "NOT ON THE CLOCK YET");
const night = await snap(at(2, 0), "22:00", "06:00");
check(`02:00 -> mid-shift still WHEN CAN I LOG OFF (${night.percent})`, night.title, "WHEN CAN I LOG OFF");

console.log("\n=== BUG 2: day shift 09:00->18:00, nothing may read 100 before the shift ends ===");
for (const [h, m, s] of [[17, 49, 0], [17, 57, 0], [17, 59, 29], [17, 59, 59]]) {
  const r = await snap(at(h, m, s), "09:00", "18:00");
  const t = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  check(`${t} bar not full   ${r.bar}`, r.bar, (b) => b.includes("-"));
  check(`${t} count not 100  ${r.count}`, r.count, (c) => c !== "100/100");
  check(`${t} percent < 100  ${r.percent}`, r.percent, (p) => p !== "100.0%");
}
const done = await snap(at(18, 0, 0), "09:00", "18:00");
check(`18:00:00 bar full      ${done.bar}`, done.bar, (b) => !b.includes("-"));
check(`18:00:00 count 100/100 ${done.count}`, done.count, "100/100");
check(`18:00:00 percent 100.0% ${done.percent}`, done.percent, "100.0%");
check("18:00:00 title complete", done.title, "YOU MAY LOG OFF NOW");

console.log("\n=== The 1Hz tick still advances the display across the boundary ===");
const before = await snap(at(17, 59, 58), "09:00", "18:00", 100);
check(`17:59:58 incomplete (${before.percent} ${before.count})`, before.title, "WHEN CAN I LOG OFF");
const crossed = await snap(at(17, 59, 58), "09:00", "18:00", 4000);
check("…+4s of ticks -> flips to complete", crossed.title, "YOU MAY LOG OFF NOW");
check(`…+4s of ticks -> 100.0% (${crossed.bar})`, crossed.percent, "100.0%");

console.log("\n=== Error messaging + regressions ===");
const same = await snap(at(12, 0), "09:00", "09:00");
check("identical times -> ERR_0x01", same.errText, (t) => t.includes("ERR_0x01") && t.includes("DIFFER"));
check("identical times -> error visible", same.errShown, true);
const preShift = await snap(at(7, 0), "09:00", "18:00");
check("07:00 day shift -> NOT ON THE CLOCK YET", preShift.title, "NOT ON THE CLOCK YET");
check("07:00 day shift -> no error", preShift.errShown, false);
const mid = await snap(at(13, 30), "09:00", "18:00");
check(`13:30 -> 50.0% (${mid.bar})`, mid.percent, "50.0%");
check("13:30 -> FREEDOM ETA note", mid.note, (n) => n.startsWith("FREEDOM ETA"));
check("zoom applied (layout fit ran)", mid.zoom, (z) => z !== "" && z !== undefined);

console.log(`\n${fail === 0 ? "ALL GREEN" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
