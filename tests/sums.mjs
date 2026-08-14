const BASE = process.env.BASE_URL || "http://127.0.0.1:8781";
import { chromium } from "playwright";
const b = await chromium.launch();
const toMin = s => { const m = s.match(/(\d+)h (\d+)m/); return +m[1]*60 + +m[2]; };
let bad = 0;
const cases = [[9,17,0],[13,30,0],[13,30,30],[10,5,17],[17,59,59],[9,0,0],[12,0,45],[16,42,8]];
for (const [h,m,s] of cases) {
  const ctx = await b.newContext();
  await ctx.addInitScript(() => { localStorage.setItem("workday-start","09:00"); localStorage.setItem("workday-end","18:00"); });
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date(2026,7,10,h,m,s) });
  await p.goto(`${BASE}/index.html`);
  await p.clock.runFor(50);
  const r = await p.evaluate(() => ({
    w: document.querySelector("#worked").textContent,
    r: document.querySelector("#remaining").textContent,
    d: document.querySelector("#duration").textContent,
  }));
  const ok = toMin(r.w) + toMin(r.r) === toMin(r.d);
  if (!ok) bad++;
  console.log(`  ${ok?"OK  ":"FAIL"} ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}  ${r.w} + ${r.r} = ${r.d}`);
  await ctx.close();
}
console.log(bad===0 ? "\nWORKED + REMAINING always equals TOTAL SHIFT." : `\n${bad} mismatch(es).`);
await b.close(); process.exit(bad===0?0:1);
