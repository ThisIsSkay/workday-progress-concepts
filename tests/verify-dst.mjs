const BASE = process.env.BASE_URL || "http://127.0.0.1:8781";
import { chromium } from "playwright";

const browser = await chromium.launch();
let pass = 0, fail = 0;

// Absolute instants, so the NY local time is unambiguous.
const utc = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo, d, h, mi, 0));

async function snap({ start, end, when, tz = "America/New_York", advance = 100 }) {
  const ctx = await browser.newContext({ timezoneId: tz });
  await ctx.addInitScript(([s, e]) => {
    localStorage.setItem("workday-start", s);
    localStorage.setItem("workday-end", e);
  }, [start, end]);
  const page = await ctx.newPage();
  await page.clock.install({ time: when });
  await page.goto(`${BASE}/index.html`);
  await page.clock.runFor(advance);
  const out = await page.evaluate(() => ({
    startVal: document.querySelector("#start-time").value,
    endVal: document.querySelector("#end-time").value,
    title: document.querySelector("#title-text").textContent,
    percent: document.querySelector("#percent").textContent,
    note: document.querySelector("#end-note").textContent,
    remaining: document.querySelector("#remaining").textContent,
    errShown: !document.querySelector("#error").hidden,
    errText: document.querySelector("#error").textContent,
    warnShown: !document.querySelector("#warning").hidden,
    warnText: document.querySelector("#warning").textContent,
  }));
  await ctx.close();
  return out;
}

function check(label, actual, expected) {
  const ok = typeof expected === "function" ? expected(actual) : actual === expected;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got: ${JSON.stringify(actual)}`}`);
  ok ? pass++ : fail++;
}

console.log("\n=== Bug 1: nonexistent local time in the spring-forward gap ===");
for (const [h, m, lbl] of [[7, 15, "03:15 EDT"], [7, 30, "03:30 EDT"], [6, 30, "01:30 EST"]]) {
  const r = await snap({ start: "02:30", end: "03:30", when: utc(2026, 2, 8, h, m) });
  check(`Mar 8 ${lbl} -> ERR_0x03, not a silently moved shift`, r.errText, (t) => t.includes("ERR_0x03"));
  check(`Mar 8 ${lbl} -> error visible, results hidden`, r.errShown, true);
  check(`Mar 8 ${lbl} -> no NaN leaked into the percent`, r.percent, (p) => !p.includes("NaN"));
}
const normalDay = await snap({ start: "02:30", end: "03:30", when: utc(2026, 2, 15, 7, 15) });
check("Mar 15 03:15 (no DST gap) -> same times work fine", normalDay.errShown, false);
check("Mar 15 03:15 -> shift is running", normalDay.title, "WHEN CAN I LOG OFF");

console.log("\n=== Bug 2: overnight grace must not inherit tomorrow's DST shift ===");
const g = await snap({ start: "18:00", end: "02:30", when: utc(2026, 2, 7, 7, 45) });
check("Mar 7 02:45 EST -> shift already finished", g.title, "YOU MAY LOG OFF NOW");
check("Mar 7 02:45 EST -> ended 2:30 AM, not 3:30", g.note, (n) => n.includes("2:30") && !n.includes("3:30"));
check("Mar 7 02:45 EST -> 100.0000%, not 92.1%", g.percent, "100.0000%");
check("Mar 7 02:45 EST -> nothing remaining", g.remaining, "0h 00m");
const gOk = await snap({ start: "18:00", end: "02:30", when: utc(2026, 7, 10, 6, 45) });
check("non-DST night, same shape -> still completed", gOk.title, "YOU MAY LOG OFF NOW");
const gLive = await snap({ start: "18:00", end: "02:30", when: utc(2026, 2, 7, 6, 0) });
check("Mar 7 01:00 EST -> mid-shift, still running", gLive.title, "WHEN CAN I LOG OFF");

console.log("\n=== Bug 3: 16h typo warning uses entered span, not elapsed ===");
const fn = await snap({ start: "10:00", end: "03:00", when: utc(2026, 2, 7, 17, 0) });
check("Mar 7 10:00->03:00 (17h typed, 16h elapsed) -> warns", fn.warnShown, true);
check("  …and reports the typed 17h", fn.warnText, (t) => t.includes("17h 00m"));
const fp = await snap({ start: "10:00", end: "02:00", when: utc(2026, 9, 31, 16, 0) });
check("Oct 31 10:00->02:00 (16h typed, 17h elapsed) -> no warn", fp.warnShown, false);
const plain = await snap({ start: "09:00", end: "18:00", when: utc(2026, 7, 10, 17, 30) });
check("ordinary 9h shift -> no warn", plain.warnShown, false);
const long = await snap({ start: "08:00", end: "01:00", when: utc(2026, 7, 10, 20, 0) });
check("17h shift on an ordinary day -> warns", long.warnShown, true);

console.log("\n=== Bug 4: stored values that the control would reject ===");
const corrupt = await snap({ start: "9am", end: "18:00", when: utc(2026, 7, 10, 17, 0) });
check("'9am' -> falls back to 09:00", corrupt.startVal, "09:00");
check("'9am' -> no error state", corrupt.errShown, false);
const secs = await snap({ start: "09:00:30", end: "09:01:30", when: utc(2026, 7, 10, 13, 0) });
check("'09:00:30' -> falls back to 09:00", secs.startVal, "09:00");
check("'09:01:30' -> falls back to 18:00", secs.endVal, "18:00");
check("seconds values -> no bogus 25% reading", secs.percent, (p) => p !== "25.3%");

console.log(`\n${fail === 0 ? "ALL GREEN" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
