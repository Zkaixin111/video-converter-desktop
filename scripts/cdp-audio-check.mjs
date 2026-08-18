/**
 * 音频提取（TODO-20）的界面验证：开发态，CDP 驱动真实界面。
 *
 * 断言的是「两条输出路线互不污染」这件事：
 *   1. 输出类型开关存在且默认落在「视频转换」——老用户的界面不该一进来就变
 *   2. 切到「仅提取音频」后：视频八宫格换成 MP3/M4A 两项、判定条换成音频口径、
 *      输出路径的扩展名变成 .mp3
 *   3. 切回「视频转换」：八宫格回来、输出路径回到 .mp4（来回切不留下残留）
 *   4. 批量（3 个文件）时汇总条按音频口径显示，每条仍带自己的判定
 *   5. 无音轨源文件：判定条给出明确原因，且「开始提取」被禁用
 *
 * 用法：
 *   CDP_PORT=9222 pnpm dev      （另一个终端）
 *   node scripts/cdp-audio-check.mjs 9222
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const TMP = path.join(ROOT, 'tests', '.tmp', 'cdp-audio');
const OUT_DIR = path.join(TMP, 'out');

const PORT = Number(process.argv[2] || 9222);

fs.mkdirSync(TMP, { recursive: true });
const SOURCE = path.join(FIX, 'sample-h264-aac.mp4');
const NO_AUDIO = path.join(FIX, 'sample-noaudio.mp4');
const POOL = [];
for (let i = 1; i <= 3; i += 1) {
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

/**
 * 截图加了超时兜底。
 * CDP 的 captureScreenshot 在窗口被遮挡 / 视口被临时改高时偶尔不返回，
 * 而截图只是留证、不是断言 —— 卡住整个脚本不值得，超时就跳过并记一笔。
 */
async function shot(name) {
  const grab = send('Page.captureScreenshot', { format: 'png' });
  const timer = new Promise((_, rej) => setTimeout(() => rej(new Error('截图超时')), 8000));
  try {
    const r = await Promise.race([grab, timer]);
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
  } catch (err) {
    fs.appendFileSync(path.join(TMP, 'check.log'), `⚠️  截图 ${name} 未生成：${String(err)}\n`);
  }
}

async function shotTall(name, height = 900) {
  // 等 toast 散掉再拍，否则红/黄条会盖住判定条
  for (let i = 0; i < 40; i += 1) {
    if ((await evalJs('document.querySelectorAll(".toast").length')) === 0) break;
    await sleep(150);
  }
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
  // 边跑边写文件（同步写）：stdout 被管道缓冲时进程一被杀就全丢，
  // 卡在哪一步就看不出来了
  const line = `${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}\n`;
  fs.appendFileSync(path.join(TMP, 'check.log'), line);
  console.log(line.trimEnd());
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
    await st.updateSettings({ queueMode: 'shared', failurePolicy: 'continue' });
    window.__appStore.setState({ outputDir: ${JSON.stringify(OUT_DIR)}, target: 'mp4' });
    // reset 刻意保留输出类型（就像保留 target 一样）：换一个文件接着抽音频是常见操作。
    // 所以要拿到「视频基线」得显式切回来，不能指望 reset 帮我们复位。
    await st.setOutputKind('video');
    await st.setAudioFormat('mp3');
    st.setPage('convert');
    await new Promise(r => setTimeout(r, 250));
    const s = window.__appStore.getState();
    return { stage: s.stage, count: s.batch.length };
  })()`);

const addFiles = (paths) =>
  evalJs(`(async () => {
    await window.__appStore.getState().addToBatch(${JSON.stringify(paths)});
    await new Promise(r => setTimeout(r, 400));
    const s = window.__appStore.getState();
    return { count: s.batch.length, stage: s.stage };
  })()`);

/** 读一次界面上的关键文本：不依赖 store，直接看 DOM，才算真的验证了渲染 */
const readUi = () =>
  evalJs(`(() => {
    const txt = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
    const pressed = (sel) => [...document.querySelectorAll(sel)]
      .filter(e => e.getAttribute('aria-pressed') === 'true').map(e => e.textContent.trim());
    const labels = [...document.querySelectorAll('.section-label')].map(e => e.textContent.trim());
    const banner = document.querySelector('.banner .b-title')?.textContent.trim() ?? '';
    const startBtn = [...document.querySelectorAll('button')]
      .find(b => /开始(转换|提取)/.test(b.textContent));
    const fmtNames = [...document.querySelectorAll('.fmt .fname')].map(e => e.textContent.trim());
    return {
      labels,
      kinds: pressed('.segmented[aria-label="输出类型"] button'),
      fmtNames,
      banner,
      outputPath: document.querySelector('.output-row .path')?.textContent.trim() ?? '',
      startText: startBtn?.textContent.trim() ?? '',
      startDisabled: startBtn ? startBtn.disabled : null,
      batchTitle: document.querySelector('.batch-head .b-title')?.textContent.trim() ?? '',
      batchSub: document.querySelector('.batch-head .b-sub')?.textContent.trim() ?? '',
      summaryTitle: document.querySelector('.bb-title')?.textContent.trim() ?? '',
      rowModes: txt('.batch-row .b-mode'),
      warnings: txt('.banner-warnings span'),
    };
  })()`);

const setKind = (kind) =>
  evalJs(`(async () => {
    await window.__appStore.getState().setOutputKind(${JSON.stringify(kind)});
    await new Promise(r => setTimeout(r, 400));
    return window.__appStore.getState().outputKind;
  })()`);

const setAudioFormat = (format) =>
  evalJs(`(async () => {
    await window.__appStore.getState().setAudioFormat(${JSON.stringify(format)});
    await new Promise(r => setTimeout(r, 400));
    return window.__appStore.getState().audioFormat;
  })()`);

/* ── 1. 视频路线：界面与 TODO-20 之前一致 ────────────────── */
await resetConvert();
await addFiles([POOL[0]]);
{
  const ui = await readUi();
  check('输出类型开关存在，且默认落在「视频转换」', ui.kinds.join() === '视频转换', ui.kinds.join());
  check('视频路线仍是 8 个容器', ui.fmtNames.length === 8, ui.fmtNames.join('/'));
  check('输出路径仍是 .mp4', ui.outputPath.endsWith('.mp4'), ui.outputPath);
  check('按钮文案仍是「开始转换」', ui.startText === '开始转换', ui.startText);
  await shotTall('audio-01-video-baseline.png', 820);
}

/* ── 2. 切到「仅提取音频」 ──────────────────────────────── */
await setKind('audio');
{
  const ui = await readUi();
  check('格式选择器换成 MP3 / M4A 两项', ui.fmtNames.join('/') === 'MP3/M4A', ui.fmtNames.join('/'));
  check('小节标题切换成「音频格式 / 提取方式」', ui.labels.includes('音频格式') && ui.labels.includes('提取方式'), ui.labels.join());
  // 音频判定条只有两种形态：直接抽轨 / 需要重新编码
  check(
    '判定条换成音频口径',
    ['直接抽取音轨 · 不做重新编码', '需要重新编码 · 耗时略长'].includes(ui.banner),
    ui.banner,
  );
  check('输出路径变成 .mp3', ui.outputPath.endsWith('.mp3'), ui.outputPath);
  check('按钮文案变成「开始提取音频」', ui.startText.includes('提取'), ui.startText);
  await shotTall('audio-02-single-mp3.png', 820);
}

/* ── 3. 切 M4A：AAC 源应当直接抽轨 ──────────────────────── */
await setAudioFormat('m4a');
{
  const ui = await readUi();
  check('切到 M4A 后输出路径变 .m4a', ui.outputPath.endsWith('.m4a'), ui.outputPath);
  check('AAC 源抽 M4A 判定为「直接抽取音轨」', ui.banner.includes('直接抽取'), ui.banner);
  await shotTall('audio-03-single-m4a.png', 820);
}
await setAudioFormat('mp3');
{
  const ui = await readUi();
  check('切回 MP3 判定为「需要重新编码」', ui.banner.includes('重新编码'), ui.banner);
}

/* ── 4. 切回视频：不留下任何音频残留 ────────────────────── */
await setKind('video');
{
  const ui = await readUi();
  check('切回视频后仍是 8 个容器', ui.fmtNames.length === 8, ui.fmtNames.join('/'));
  check('切回视频后输出路径回到 .mp4', ui.outputPath.endsWith('.mp4'), ui.outputPath);
  check('切回视频后按钮文案回到「开始转换」', ui.startText === '开始转换', ui.startText);
}

/* ── 5. 批量：3 个文件的音频汇总 ────────────────────────── */
await resetConvert();
await setKind('audio');
await addFiles(POOL);
{
  const ui = await readUi();
  check('批量标题按音频口径', ui.batchTitle.includes('待提取') && ui.batchTitle.includes('3'), ui.batchTitle);
  check('批量副标题写明「全部提取为 MP3」', ui.batchSub.includes('全部提取为 MP3'), ui.batchSub);
  check('汇总条按音频口径', ui.summaryTitle.includes('全部提取为 MP3'), ui.summaryTitle);
  check('每条仍带自己的判定', ui.rowModes.length === 3, ui.rowModes.join('/'));
  check('批量按钮文案为「开始提取 3 个音频」', ui.startText.includes('3 个音频'), ui.startText);
  await shotTall('audio-04-batch-mp3.png', 880);
}

/* ── 6. 无音轨文件：给出原因并禁用开始 ──────────────────── */
await resetConvert();
await setKind('audio');
await addFiles([NO_AUDIO]);
{
  const ui = await readUi();
  check('无音轨文件判定条说明原因', ui.banner.includes('没有音轨'), ui.banner);
  check('无音轨时「开始提取」被禁用', ui.startDisabled === true, `disabled=${ui.startDisabled}`);
  await shotTall('audio-05-no-audio.png', 820);
}

/* ── 7. 真的提取一次 ───────────────────────────────────── */
await resetConvert();
await setKind('audio');
await addFiles([POOL[0]]);
await evalJs(`(async () => {
  await window.__appStore.getState().start();
  await new Promise(r => setTimeout(r, 300));
  return window.__appStore.getState().stage;
})()`);
{
  const stage = await evalJs('window.__appStore.getState().stage');
  check('点「开始提取音频」后进入 running', stage === 'running' || stage === 'done', stage);
  // 队列里这条要标成「仅音频」
  const audioFlag = await evalJs(`(() => {
    const q = window.__appStore.getState().queue;
    const id = window.__appStore.getState().myJobId;
    return q?.items.find(i => i.jobId === id)?.audio ?? null;
  })()`);
  check('队列条目带上 audio 标记', audioFlag === 'mp3', String(audioFlag));
  await shotTall('audio-06-running.png', 820);

  // 等它跑完（抽 2 秒素材很快）
  for (let i = 0; i < 60; i += 1) {
    const s = await evalJs('window.__appStore.getState().stage');
    if (s === 'done' || s === 'error') break;
    await sleep(300);
  }
  const final = await evalJs(`(() => {
    const s = window.__appStore.getState();
    return { stage: s.stage, outputPath: s.result?.outputPath ?? '', error: s.error?.message ?? '' };
  })()`);
  check('提取成功落盘', final.stage === 'done' && final.outputPath.endsWith('.mp3'), JSON.stringify(final));
  check(
    '产物真的存在',
    fs.existsSync(final.outputPath) && fs.statSync(final.outputPath).size > 0,
    final.outputPath,
  );
  await shotTall('audio-07-done.png', 820);
}

console.table(results);
console.log(`\n截图：${SHOTS}`);
console.log(`\n✅ 音频提取界面检查全部通过（${results.length} 项）`);
