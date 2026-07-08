/**
 * 通过 Chrome DevTools Protocol 给运行中的 Electron 窗口截图 + 取 DOM 体检数据。
 *
 * 用途：在不能安装 Playwright / 不能调 PowerShell 截屏的环境里，
 * 仍然能拿到「界面到底渲染成什么样」的第一手证据。
 *
 * 用法：
 *   node scripts/cdp-shot.mjs [输出文件] [表达式]
 * 前提：应用以 --remote-debugging-port=9222 启动。
 */
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9222);
const OUT = process.argv[2] || 'shot.png';
const EXPR =
  process.argv[3] ||
  `JSON.stringify({
     title: document.title,
     bodyClass: document.querySelector('.win')?.className,
     navs: [...document.querySelectorAll('.nav-item')].length,
     dropzone: !!document.querySelector('.dropzone'),
     features: [...document.querySelectorAll('.feature-strip > div')].length,
     cssLoaded: getComputedStyle(document.body).fontSize,
     winSize: [document.querySelector('.win')?.clientWidth, document.querySelector('.win')?.clientHeight],
   })`;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('没有找到页面目标');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
  else p.resolve(msg.result);
});

await new Promise((r) => ws.addEventListener('open', r, { once: true }));

await send('Page.enable');
const evalRes = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
console.log('DOM:', evalRes.result?.value);

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('截图已保存:', OUT);
ws.close();
