const BASE = process.env.BASE_URL || "http://127.0.0.1:8781";
import { chromium } from "playwright";
const b = await chromium.launch();
const sizes = [[1920,1080],[1600,900],[1440,900],[1366,768],[1280,800],[1280,720],[1024,768],[900,700],[800,600],[1280,560],[1280,480],[720,700],[700,600]];
let bad = 0;
for (const [w,h] of sizes) {
  const ctx = await b.newContext({ viewport:{width:w,height:h} });
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date(2026,7,10,13,30,0) });
  await p.goto(`${BASE}/index.html`);
  await p.clock.runFor(100);
  const r = await p.evaluate(() => ({
    zoom: +(document.querySelector(".crt").style.zoom || 1),
    over: document.documentElement.scrollHeight - window.innerHeight,
  }));
  const ok = r.over <= 0;
  if (!ok) bad++;
  console.log(`  ${ok?"OK  ":"OVER"} ${String(w).padStart(4)}x${String(h).padStart(4)}  zoom=${r.zoom.toFixed(3)}  overflow=${r.over}px`);
  await ctx.close();
}
console.log(bad===0 ? "\nNo viewport overflows." : `\n${bad} viewport(s) still overflow.`);
await b.close();
process.exit(bad===0?0:1);
