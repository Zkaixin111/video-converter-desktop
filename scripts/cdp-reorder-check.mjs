/**
 * 队列顺序与暂停控制（TODO-13）的界面验证（真实队列 + 真实判定）。
 *
 * 这里刻意用**四个真实文件**而不是 fake：
 *   排序的价值只有在「下一个真的会是它」的时候才成立，
 *   用假 job 验证出来的顺序，跟用户眼里的顺序不是一回事。
 *
 * 用法：
 *   CDP_PORT=9222 env -u ELECTRON_RUN_AS_NODE npm run dev   （另一个终端）
 *   node scripts/cdp-reorder-check.mjs 9222
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const LOG = path.join(ROOT, 'tests', '.tmp', 'reorder-check.log');
const PORT = Number(process.argv[2] || 9222);

fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(LOG, '', 'utf8');

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('没有找到可调试的页面，确认 dev 是用 CDP_PORT 启动的');
const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id, method, params }));
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
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  }
  return r.result?.value;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name) {
  const r = await Promise.race([
    send('Page.captureScreenshot', { format: 'png' }),
    sleep(8000).then(() => null),
  ]);
  if (!r) return console.log(`⚠️ 截图 ${name} 未生成`);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
}

async function waitFor(expr, label, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(expr)) return;
    await sleep(120);
  }
  throw new Error(`等待超时（${timeoutMs}ms）：${label}`);
}

const results = [];
function check(name, pass, detail = '') {
  const line = `${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`;
  fs.appendFileSync(LOG, `${line}\n`, 'utf8');
  console.log(line);
  results.push({ 检查项: name, 结果: pass ? '✅' : '❌', 说明: detail });
  if (!pass) throw new Error(`断言失败：${name} ${detail}`);
}

await waitFor('!!window.__appStore', 'store 注入完成（DEV 专用）', 40000);
check('store 已挂到 window（DEV）', true);

/* ── 工具 ─────────────────────────────────────────────── */
const resetUi = () =>
  evalJs(`(async () => {
    const st = () => window.__appStore.getState();
    await st().setPage('queue');
    await st().updateSettings({ openFolderAfterDone: false, failurePolicy: 'continue' });
    for (let i = 0; i < 6; i += 1) {
      await st().refreshQueue();
      const items = st().queue?.items ?? [];
      if (items.length === 0) break;
      for (const it of items) {
        if (it.status === 'running' || it.status === 'preparing') await st().cancelQueueItem(it.jobId);
      }
      await new Promise(r => setTimeout(r, 700));
      for (const it of (st().queue?.items ?? [])) {
        try { await st().removeQueueItem(it.jobId); } catch {}
      }
    }
    await st().resumeQueue();
    await st().refreshQueue();
    return (window.__appStore.getState().queue?.items ?? []).length;
  })()`);

/** 入队 4 个真实文件，然后立刻暂停，留出一个稳定的等待序列 */
const seedQueue = () =>
  evalJs(`(async () => {
    const st = () => window.__appStore.getState();
    const src = ${JSON.stringify(
      ['sample-h264-aac.mp4', 'sample-mpeg4-mp3.avi', 'sample-h264-ac3.mkv', 'sample-noaudio.mp4'].map(
        (f) => `${ROOT.replace(/\\/g, '/')}/tests/fixtures/${f}`,
      ),
    )};
    await st().enqueuePaths(src);
    // 只给一瞬让它起第一个任务就暂停：这批 fixture 很小，多等一会儿就有几个转完了、
    // 等待序列变短，后面的「第 N 位」断言反而会漂
    await new Promise(r => setTimeout(r, 150));
    await st().pauseQueue();
    await st().refreshQueue();
    return true;
  })()`);

const snapshot = () =>
  evalJs(`(async () => {
    const st = () => window.__appStore.getState();
    await st().refreshQueue();
    await new Promise(r => setTimeout(r, 150));
    const q = window.__appStore.getState().queue;
    return {
      paused: !!q?.paused,
      reason: q?.pausedReason ?? null,
      order: (q?.items ?? []).map(i => i.fileName.replace(/\\.(mp4|avi|mkv)$/, '')),
      statuses: (q?.items ?? []).map(i => i.status),
      first: (q?.items ?? [])[0]?.fileName ?? null,
    };
  })()`);

const move = (jobId, delta) =>
  evalJs(`(async () => {
    const st = () => window.__appStore.getState();
    await st().reorderQueueItem(${JSON.stringify(jobId)}, ${JSON.stringify(delta)});
    await new Promise(r => setTimeout(r, 250));
    return true;
  })()`);

/**
 * 等待中的任务序列（有序）。
 *
 * 排序验证一律以它为准而不是队列数组的绝对下标：
 * 数组里还夹着一个正在跑的任务，拿绝对下标算出来的「第几个」跟用户看到的不是一回事。
 */
const pendingIds = () =>
  evalJs(`(async () => {
    const st = window.__appStore.getState();
    await st.refreshQueue();
    const q = window.__appStore.getState().queue?.items ?? [];
    return q.filter(i => i.status === 'pending').map(i => i.jobId);
  })()`);

const cleanedFirst = await resetUi();
check('起点是空队列', cleanedFirst === 0, String(cleanedFirst));
await seedQueue();
await waitFor(
  '(window.__appStore.getState().queue?.items ?? []).filter(i => i.status === "pending").length >= 2',
  '队列里有至少两个等待中的任务',
  20000,
);

/* ── 1. 暂停 ───────────────────────────────────────────── */
const v1 = await snapshot();
check('主动暂停生效', v1.paused === true && v1.reason === 'manual', `reason=${v1.reason}`);
check('暂停后不再有新的开始跑', v1.statuses.filter((s) => s === 'pending').length >= 2, v1.statuses.join(' | '));
check(
  '工具栏给出一个可以继续的出口',
  await evalJs(
    `[...document.querySelectorAll('.page-head button')].some(b => b.textContent.trim() === '继续队列')`,
  ),
);

await shot('p1-13-reorder-idle.png');

/* ── 2. 键盘排序（Alt+↑/↓ 走的是同一条 delta 通道） ────── */
const beforeIds = await pendingIds();
// 取等待序列的最后一项，往前移到底 = 拖 Digit(this) 到位次 1
const moving = beforeIds[beforeIds.length - 1];
await move(moving, -(beforeIds.length - 1));
const afterUpIds = await pendingIds();
check(
  '负 delta 把队尾的任务移到了队首',
  afterUpIds[0] === moving,
  `期望 ${moving}，实际 ${afterUpIds[0]}`,
);
check('其余任务的相对顺序没被打乱', afterUpIds.slice(1).join(',') === beforeIds.slice(0, -1).join(','), afterUpIds.join(' | '));

/* ── 3. 拖拽 ← 这一步走真实 DOM 事件 ────────────────────── */
const dragResult = await evalJs(`(async () => {
  const st = window.__appStore.getState();
  await st.refreshQueue();
  const rows = [...document.querySelectorAll('.queue-row.is-pending')];
  if (rows.length < 2) return { ok: false, why: '等待中的行不足两行' };
  const from = rows[0];
  const to = rows[rows.length - 1];
  const dt = new DataTransfer();
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  await new Promise(r => setTimeout(r, 60));
  to.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
  to.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, cancelable: true }));
  await new Promise(r => setTimeout(r, 60));
  const hinted = document.querySelectorAll('.queue-row.is-dragging, .queue-row.is-drop').length;
  to.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, cancelable: true }));
  await new Promise(r => setTimeout(r, 350));
  return { ok: true, hinted };
})()`);
check('拖拽过程中给得出视觉反馈', dragResult.ok && dragResult.hinted > 0, JSON.stringify(dragResult));

const afterDragIds = await pendingIds();
check(
  '把第一行拖到最后一行后，它真的排到了最后',
  afterDragIds[afterDragIds.length - 1] === afterUpIds[0],
  `${afterUpIds.join(' > ')} → ${afterDragIds.join(' > ')}`,
);
await shot('p1-13-reorder-sorted.png');

/* ── 4. 顺序决定下一个跑谁 ─────────────────────────────── */
const headId = afterDragIds[0];
await evalJs(`(async () => {
  await window.__appStore.getState().resumeQueue();
  return true;
})()`);

// 并发 1 时队列里还有一个先跑起来的任务，所以要等它结束、调度器再取队首
let startedId = null;
for (let i = 0; i < 100; i += 1) {
  const cur = await evalJs(`(async () => {
    const st = window.__appStore.getState();
    await st.refreshQueue();
    const q = window.__appStore.getState().queue?.items ?? [];
    const hit = q.find(i2 => i2.status === 'running' || i2.status === 'preparing');
    return hit ? hit.jobId : null;
  })()`);
  if (cur && cur === headId) {
    startedId = cur;
    break;
  }
  await sleep(300);
}
check(
  '暂停解除后，轮到的正是排在最前的那一个',
  startedId === headId,
  `期望 ${headId}，实际 ${startedId ?? '（没有任务在跑）'}`,
);

/* ── 5. 收尾 ───────────────────────────────────────────── */
await resetUi();
const cleaned = await snapshot();
check('清理后队列为空', cleaned.order.length === 0, cleaned.order.join(' | '));

console.log('\n══════ 顺序与暂停检查汇总 ══════');
console.table(results);
ws.close();
process.exit(0);
