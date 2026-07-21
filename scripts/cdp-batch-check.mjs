/**
 * 转换页批量添加与数量限制的界面验证（开发态，CDP 驱动真实界面）。
 *
 * 断言的不只是「能加进去」，而是三条硬规则：
 *   1. 逐个添加：加完一个之后「加入下一个视频」的入口还在，且能继续加
 *   2. 一次选多个：一次 15 个只收前 10 个，并给出「单次上限」的明确提示
 *   3. 总上限：满 10 个后按钮变灰 + 文案变成「已达上限」，再拖文件进来只会弹提示
 * 另外回归一遍单文件流程（1 个文件时的视图与转换必须和以前一样）。
 *
 * 用法：
 *   CDP_PORT=9222 pnpm dev      （另一个终端）
 *   node scripts/cdp-batch-check.mjs 9222
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const TMP = path.join(ROOT, 'tests', '.tmp', 'cdp-batch');
const OUT_DIR = path.join(TMP, 'out');

const PORT = Number(process.argv[2] || 9222);

/* ── 准备素材：15 个真实可探测的视频（fixture 只有 7 个，复制出副本） ── */
fs.mkdirSync(TMP, { recursive: true });
const SOURCE = path.join(FIX, 'sample-h264-aac.mp4');
const POOL = [];
for (let i = 1; i <= 15; i += 1) {
  const p = path.join(TMP, `clip-${String(i).padStart(2, '0')}.mp4`);
  if (!fs.existsSync(p)) fs.copyFileSync(SOURCE, p);
  POOL.push(p);
}

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
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
}

/** 等 toast 自动消失（warning 4000ms + 200ms 淡出），避免截图被遮挡 */
async function waitToastsGone(timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await evalJs('document.querySelectorAll(".toast").length')) === 0) return;
    await sleep(150);
  }
}

/**
 * 长截图：临时把视口拉高再拍，让「列表 + 添加条 + 汇总条」一次进画面。
 * 用 Emulation 覆盖而不是改窗口大小，拍完立刻还原，不影响后续交互。
 */
async function shotTall(name, height = 900) {
  await waitToastsGone();
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1100,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(300);
  await shot(name);
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(200);
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ 检查项: name, 结果: pass ? '✅' : '❌', 说明: detail });
  if (!pass) throw new Error(`断言失败：${name} ${detail}`);
}

/* ── 0. 就绪 + 复位 ─────────────────────────────────────── */
for (let i = 0; i < 100; i += 1) {
  if (await evalJs('!!window.__appStore')) break;
  await sleep(200);
}
check('store 已挂到 window（DEV）', await evalJs('!!window.__appStore'));

const resetConvert = () =>
  evalJs(`(async () => {
    const st = window.__appStore.getState();
    st.reset();
    // 复位成「共用全局参数 + 失败继续」，免得上一轮跑队列脚本留下的单任务模式
    // 把这一次入队的任务标成「自定义」，截图里容易误读成转换页做了什么特殊处理
    await st.updateSettings({ queueMode: 'shared', failurePolicy: 'continue' });
    window.__appStore.setState({ outputDir: ${JSON.stringify(OUT_DIR)}, target: 'mp4' });
    st.setPage('convert');
    await new Promise(r => setTimeout(r, 250));
    const s = window.__appStore.getState();
    return { stage: s.stage, count: s.batch.length, toasts: s.toasts.length };
  })()`);

const addFiles = (paths) =>
  evalJs(`(async () => {
    await window.__appStore.getState().addToBatch(${JSON.stringify(paths)});
    await new Promise(r => setTimeout(r, 150));
    const s = window.__appStore.getState();
    return {
      stage: s.stage, count: s.batch.length,
      primary: s.meta?.fileName ?? null,
      lastToast: s.toasts.at(-1)?.message ?? null,
      toastType: s.toasts.at(-1)?.type ?? null,
    };
  })()`);

/** 读界面上的关键文案与按钮状态（断言要落在 DOM 上，而不是只信 store） */
const readUi = () =>
  evalJs(`(() => {
    const addBtn = [...document.querySelectorAll('.batch-add button')].find(b => b.textContent.includes('加入下一个视频'));
    const manyBtn = [...document.querySelectorAll('.batch-add button')].find(b => b.textContent.trim() === '一次选多个');
    const rows = [...document.querySelectorAll('.batch-row')];
    return {
      rows: rows.length,
      names: rows.map(r => r.querySelector('.b-name')?.textContent),
      modes: rows.map(r => r.querySelector('.b-mode')?.textContent ?? null),
      hint: document.querySelector('.batch-add-hint')?.textContent ?? null,
      hintFull: !!document.querySelector('.batch-add-hint.is-full'),
      addDisabled: addBtn ? addBtn.disabled : null,
      manyDisabled: manyBtn ? manyBtn.disabled : null,
      addVisible: !!addBtn,
      startText: document.querySelector('.action-row .btn')?.textContent ?? null,
      summaryTitle: document.querySelector('.batch-banner .bb-title')?.textContent ?? null,
      summaryDesc: document.querySelector('.batch-banner .bb-desc')?.textContent ?? null,
      hasFileCard: !!document.querySelector('.filecard'),
      hasDropzone: !!document.querySelector('.dropzone'),
      dropMore: !!document.querySelector('.dz-more'),
      firstOut: rows[0] ? null : null,
    };
  })()`);

/** 「加入下一个视频」入口在单文件时也要在（规格原话：每添加一个后提供该入口） */
const reset0 = await resetConvert();
check('复位后回到空态', reset0.stage === 'empty' && reset0.count === 0, JSON.stringify(reset0));

const emptyUi = await readUi();
check('空态仍是原型的拖拽区', emptyUi.hasDropzone === true);
check('空态提供「一次选择多个」入口', emptyUi.dropMore === true);

/* ── 1. 单次添加上限：一次选 15 个只收前 10 个 ──────────── */
const onceCap = await addFiles(POOL);
check('一次选 15 个：只收前 10 个', onceCap.count === 10, String(onceCap.count));
check(
  '提示说明这是「单次上限」而不是总数',
  /一次最多添加 10 个视频/.test(onceCap.lastToast ?? ''),
  String(onceCap.lastToast),
);
const firstTen = await evalJs(
  `window.__appStore.getState().batch.map(e => e.meta.fileName)`,
);
check(
  '保留的是前 10 个（顺序不被打乱）',
  firstTen.length === 10 && firstTen[0] === 'clip-01.mp4' && firstTen[9] === 'clip-10.mp4',
  JSON.stringify(firstTen),
);

await resetConvert();

/* ── 2. 逐个添加：加完一个还能加下一个 ───────────────────── */
const one = await addFiles([POOL[0]]);
check('加入第 1 个视频后进入 setup', one.stage === 'setup' && one.count === 1, JSON.stringify(one));

let ui = await readUi();
check('单个文件仍是原文文件卡视图', ui.hasFileCard === true && ui.rows === 0);
check('单个文件时「加入下一个视频」入口已出现', ui.addVisible === true);
check('单个文件的开始按钮文案不变', ui.startText === '开始转换', String(ui.startText));
check('计数提示显示 1/10', /已选 1\/10/.test(ui.hint ?? ''), String(ui.hint));
await waitToastsGone();
await shot('p1-08-batch-single.png');

const two = await addFiles([POOL[1]]);
check('再点一次能继续加第 2 个', two.count === 2, JSON.stringify(two));

ui = await readUi();
check('2 个起切换为批次列表', ui.rows === 2 && ui.hasFileCard === false);
check('列表逐行显示判定结果', ui.modes.slice(0, 2).every((m) => m === '直通'), JSON.stringify(ui.modes));
check('出现批量汇总判定条', /全部转为 MP4/.test(ui.summaryTitle ?? ''), String(ui.summaryTitle));
check('汇总条说明了逐个判定与执行位置', /逐个判定/.test(ui.summaryDesc ?? '') && /任务队列/.test(ui.summaryDesc ?? ''));
check('开始按钮带上数量', ui.startText === '开始转换 2 个视频', String(ui.startText));

/* ── 2. 一次选多个 + 单次上限 10 ─────────────────────────── */
const many = await addFiles(POOL.slice(2)); // 13 个
check('一次添加超过上限时只收前 10 个（总数卡在 10）', many.count === 10, JSON.stringify(many));
check('给出了明确的超限提示', /最多同时转换 10 个/.test(many.lastToast ?? ''), String(many.lastToast));

ui = await readUi();
check('列表正好 10 行', ui.rows === 10, String(ui.rows));
check('达到上限后「加入下一个视频」被禁用', ui.addDisabled === true, String(ui.addDisabled));
check('达到上限后「一次选多个」被禁用', ui.manyDisabled === true, String(ui.manyDisabled));
check('提示文案变成「已达上限」', /已达上限 10 个/.test(ui.hint ?? ''), String(ui.hint));
check('提示用了强调色', ui.hintFull === true);
// 这条截图要点在「已达上限」的添加条，所以拉高视口把列表 + 添加条 + 汇总条都拍进去
await shotTall('p1-09-batch-limit.png', 980);

/* ── 3. 满了之后再添加：一个都不收，并再提示一次 ────────── */
const over = await addFiles([POOL[10]]);
check('满 10 个后再加：数量不变', over.count === 10, String(over.count));
check('满 10 个后再加：弹出上限提示', /最多同时转换 10 个/.test(over.lastToast ?? ''), String(over.lastToast));

/* ── 4. 统一目标格式：所有条目一起重算 ──────────────────── */
const before = await evalJs(
  `window.__appStore.getState().batch.map(e => e.outputPath.split('.').pop())`,
);
check('切换前所有条目的输出扩展名都是 mp4', before.every((e) => e === 'mp4'), JSON.stringify(before));

await evalJs(`(async () => {
  await window.__appStore.getState().setTarget('mkv');
  await new Promise(r => setTimeout(r, 400));
})()`);
const after = await evalJs(
  `window.__appStore.getState().batch.map(e => e.outputPath.split('.').pop())`,
);
check('切换目标格式后整批输出扩展名一起变成 mkv', after.every((e) => e === 'mkv'), JSON.stringify(after));
check('批量汇总条同步更新', /全部转为 MKV/.test((await readUi()).summaryTitle ?? ''));

await evalJs(`(async () => {
  await window.__appStore.getState().setTarget('mp4');
  await new Promise(r => setTimeout(r, 400));
})()`);

/* ── 5. 移除一条后又能继续加 ────────────────────────────── */
const removed = await evalJs(`(async () => {
  const s = window.__appStore.getState();
  await s.removeBatchItem(${JSON.stringify(POOL[3])});
  await new Promise(r => setTimeout(r, 200));
  const after = window.__appStore.getState();
  return { count: after.batch.length };
})()`);
check('可以单独移除批次里的某一条', removed.count === 9, JSON.stringify(removed));

ui = await readUi();
check('移除后按钮重新可用', ui.addDisabled === false, String(ui.addDisabled));

/* ── 6. 整批开始转换：交给任务队列 ──────────────────────── */
const started = await evalJs(`(async () => {
  await window.__appStore.getState().start();
  await new Promise(r => setTimeout(r, 900));
  const s = window.__appStore.getState();
  return {
    page: s.page, stage: s.stage, batch: s.batch.length,
    queue: s.queue?.items.length ?? 0,
    toast: s.toasts.at(-1)?.message ?? null,
  };
})()`);
check('批量开始后跳到任务队列页', started.page === 'queue', String(started.page));
check('转换页批次已清空、回到空态', started.batch === 0 && started.stage === 'empty', JSON.stringify(started));
// 队列里的条数会随任务完成而减少（直通任务几百毫秒就结束了），所以用提示文案核对「全部入队」
check('整批 9 个视频都进了队列', /9 个视频/.test(started.toast ?? ''), String(started.toast));
check('队列页能看到正在跑的任务', started.queue > 0, String(started.queue));
// 截图前把历史 toast 关掉，只留「已加入队列」这一条，画面干净些
await evalJs(`(async () => {
  const st = window.__appStore.getState();
  for (const t of st.toasts.slice(0, -1)) st.dismissToast(t.id);
  await new Promise(r => setTimeout(r, 350));
})()`);
await shot('p1-10-batch-queue.png');

// 收尾：把这批任务清掉，别影响后续手工验证
await evalJs(`(async () => {
  const st = window.__appStore.getState();
  await st.refreshQueue();
  for (const it of (window.__appStore.getState().queue?.items ?? [])) {
    if (it.status === 'running' || it.status === 'preparing') await window.api.cancelQueueItem(it.jobId);
  }
  await new Promise(r => setTimeout(r, 1500));
  for (const it of (window.__appStore.getState().queue?.items ?? [])) {
    try { await window.api.cancelQueueItem(it.jobId); } catch {}
  }
  await new Promise(r => setTimeout(r, 800));
  for (const it of (window.__appStore.getState().queue?.items ?? [])) {
    try { await window.api.removeQueueItem(it.jobId); } catch {}
  }
  await st.refreshQueue();
})()`);

/* ── 7. 单文件流程回归（原有流程不能被改动影响） ─────────── */
await resetConvert();
const single = await addFiles([POOL[0]]);
check('回归：单文件仍能载入', single.stage === 'setup' && single.count === 1, JSON.stringify(single));

const singleDone = await evalJs(`(async () => {
  await window.__appStore.getState().start();
  for (let i = 0; i < 60; i += 1) {
    const s = window.__appStore.getState();
    if (s.stage === 'done' || s.stage === 'error') {
      return { stage: s.stage, verified: s.result?.verified ?? null, page: s.page, size: s.result?.outputSizeBytes ?? null };
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return { stage: 'timeout' };
})()`);
check(
  '回归：单文件仍在转换页内完成并校验通过',
  singleDone.stage === 'done' && singleDone.verified === true && singleDone.page === 'convert',
  JSON.stringify(singleDone),
);
await shot('p1-11-batch-single-done.png');

ws.close();
console.table(results);
console.log(`\n截图已写入 ${SHOTS}`);

// 清理产物（测试素材保留，下次跑可复用）
try {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
} catch (err) {
  console.warn(`⚠️  临时输出目录未能清理（不影响结论）：${OUT_DIR}\n   ${String(err)}`);
}
