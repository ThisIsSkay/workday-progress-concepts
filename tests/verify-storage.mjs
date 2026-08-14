const BASE = process.env.BASE_URL || "http://127.0.0.1:8781";
import { chromium } from "playwright";

// Simulates Safari "block all cookies" / sandboxed iframe, where touching
// localStorage throws a SecurityError instead of returning null.
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  const boom = () => { throw new DOMException("blocked", "SecurityError"); };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => ({ getItem: boom, setItem: boom, removeItem: boom }),
  });
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.clock.install({ time: new Date(2026, 7, 10, 13, 30, 0) });
await page.goto(`${BASE}/index.html`);
await page.clock.runFor(100);

const render = await page.evaluate(() => ({
  percent: document.querySelector("#percent").textContent,
  title: document.querySelector("#title-text").textContent,
  worked: document.querySelector("#worked").textContent,
}));

// The inputs must still work even though nothing can be persisted.
await page.fill("#start-time", "10:00");
await page.clock.runFor(1100);
const afterEdit = await page.evaluate(() => document.querySelector("#percent").textContent);

console.log("uncaught page errors:", errors.length ? errors : "none");
console.log("rendered on load:", render);
console.log("after editing clock-in to 10:00:", afterEdit);

const ok = errors.length === 0 && render.percent === "50.0%" && afterEdit !== render.percent;
console.log(ok ? "\nPASS — storage blocked, terminal still fully functional" : "\nFAIL");
await browser.close();
process.exit(ok ? 0 : 1);
