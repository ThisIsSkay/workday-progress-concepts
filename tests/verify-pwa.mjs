const BASE = process.env.BASE_URL || "http://127.0.0.1:8781";
import { chromium } from "playwright";

let failed = 0;
function check(label, actual, expected) {
  const ok = typeof expected === "function" ? expected(actual) : Object.is(actual, expected);
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` — got ${JSON.stringify(actual)}`}`);
  if (!ok) failed++;
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(`${BASE}/index.html`);
await page.waitForFunction(() => "serviceWorker" in navigator);
await page.evaluate(() => navigator.serviceWorker.ready);

if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
}
check(
  "service worker controls the page",
  await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  true
);

const partial = await page.evaluate(async () => {
  try {
    const response = await fetch("styles.css?v=range-regression", {
      headers: { Range: "bytes=0-99" },
    });
    return { resolved: true, status: response.status };
  } catch (error) {
    return { resolved: false, error: String(error) };
  }
});
check("206 Range request still resolves through the service worker", partial.resolved, true);
check("Range request returns partial content", partial.status, 206);

await context.close();
await browser.close();

console.log(failed === 0 ? "\nPWA regression checks passed." : `\n${failed} PWA regression check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
