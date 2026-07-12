/**
 * 在打包后的应用里逐页点一遍侧边栏，确认路由/页面在 asar + file:// 环境下都正常。
 * 用法：node scripts/cdp-nav-check.mjs [端口]
 */
import fs from 'node:fs';

const PORT = Number(process.argv[2] || 9224);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? '异常');
  return r.result?.value;
};

const pages = ['转换', '任务队列', '参数预设', '设置', '关于'];
const report = [];
for (const label of pages) {
  const info = await evalJs(`(async () => {
    const nav = [...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes(${JSON.stringify(label)}));
    if (!nav) return { missing: true };
    nav.click();
    await new Promise(r => setTimeout(r, 260));   // 等 150ms 切页动画
    const h1 = document.querySelector('.page-head h1')?.textContent;
    const body = document.querySelector('.page')?.innerText?.replace(/\\s+/g, ' ').slice(0, 160);
    const active = document.querySelector('.nav-item[aria-current="page"]')?.textContent?.trim();
    return { h1, active, nodes: document.querySelectorAll('.page *').length, body };
  })()`);
  report.push({ label, ...info });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`shot-pkg-${pages.indexOf(label)}.png`, Buffer.from(shot.data, 'base64'));
}
console.table(report);
ws.close();
