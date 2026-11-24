import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1124\\chrome-win\\chrome.exe',
  args: ['--disable-logging', '--log-level=3', '--disable-gpu', '--disable-ime', '--no-first-run', '--disable-background-networking']
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.addInitScript(() => {
  const nativeTimeout = window.setTimeout.bind(window);
  window.__timeScale = 1;
  window.setTimeout = (fn, delay = 0, ...args) => nativeTimeout(fn, typeof delay === 'number' ? delay * window.__timeScale : delay, ...args);
  window.__speechDelay = 2500;
  window.__speechEvents = [];
  const mock = {
    _active: null,
    resume() {},
    getVoices() { return [{ lang: 'zh-CN', name: '中文语音' }]; },
    speak(u) {
      const event = { text: u.text, lang: u.lang, volume: u.volume, start: Date.now(), end: null, cancelled: false };
      window.__speechEvents.push(event);
      this._active = event;
      event.timer = window.setTimeout(() => {
        event.end = Date.now();
        this._active = null;
        if (u.onend) u.onend();
      }, u.volume === 0 ? 0 : window.__speechDelay);
    },
    cancel() {
      const event = this._active;
      if (event) {
        clearTimeout(event.timer);
        event.cancelled = true;
        event.end = Date.now();
        this._active = null;
      }
    }
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => mock });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: class { constructor(text) { this.text = text; } }
  });
});

const intersects = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 2;

async function layoutCheck(label) {
  const report = await page.evaluate(() => {
    const rect = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const visible = el => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    return {
      center: rect(document.querySelector('.center')),
      controls: visible(document.querySelector('#controls')) ? rect(document.querySelector('#controls')) : null,
      tools: rect(document.querySelector('.table-tools')),
      seats: [...document.querySelectorAll('.seat')].map(el => ({ name: el.querySelector('.name').textContent, rect: rect(el) })),
      table: rect(document.querySelector('#table')),
      viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }
    };
  });
  for (const seat of report.seats) {
    assert.equal(intersects(report.center, seat.rect), false, `${label}: 中央文字被 ${seat.name} 遮挡 ${JSON.stringify({ center: report.center, seat: seat.rect })}`);
    if (report.controls) assert.equal(intersects(report.controls, seat.rect), false, `${label}: 操作区遮挡 ${seat.name}`);
    assert.equal(intersects(report.tools, seat.rect), false, `${label}: 工具按钮遮挡 ${seat.name}`);
  }
  assert.ok(report.viewport.scrollWidth <= report.viewport.width + 1, `${label}: 页面横向溢出`);
  console.log(`✓ ${label} 牌桌无重叠`);
}

async function boardResultCheck(label) {
  await page.waitForFunction(() => table.over && !presenting && document.querySelector('#controls .btn-continue'), { timeout: 20000 });
  const report = await page.evaluate(() => {
    const overlay = document.querySelector('#resultOverlay');
    const msg = document.querySelector('#message').textContent;
    const detailBtn = document.querySelector('#controls .btn-detail');
    const labels = [...document.querySelectorAll('.seat .d-delta')].map(el => ({ text: el.textContent, cls: el.className }));
    return {
      overlayVisible: getComputedStyle(overlay).display !== 'none',
      msg,
      msgVisible: getComputedStyle(document.querySelector('#message')).display !== 'none',
      hasDetail: !!detailBtn,
      deltas: labels,
      controlsVisible: document.querySelector('#controls').style.visibility !== 'hidden',
      rects: {
        center: (() => { const r = document.querySelector('.center').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })(),
        message: (() => { const r = document.querySelector('#message').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })(),
        controls: (() => { const r = document.querySelector('#controls').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })(),
        table: (() => { const r = document.querySelector('#table').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })(),
        seats: [...document.querySelectorAll('.seat')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, name: el.querySelector('.name').textContent }; })
      }
    };
  });
  assert.equal(report.overlayVisible, false, `${label}: 结算不应自动弹窗`);
  assert.ok(report.msg.includes('🏆') && /你\s*[+-]?\d/.test(report.msg.replace(/\s/g, ' ')), `${label}: 桌面未显示赢家与输赢: ${report.msg}`);
  assert.ok(report.msgVisible, `${label}: 赢家文字被隐藏`);
  assert.ok(report.hasDetail, `${label}: 桌面缺少明细入口`);
  assert.ok(report.deltas.length >= 1, `${label}: 座位未显示输赢积分`);
  assert.ok(report.controlsVisible, `${label}: 继续游戏按钮不可见`);
  const { rects } = report;
  assert.ok(rects.message.left >= rects.table.left && rects.message.right <= rects.table.right + 1, `${label}: 赢家文字横向超出牌桌`);
  assert.ok(rects.message.top >= rects.table.top && rects.message.bottom <= rects.table.bottom + 1, `${label}: 赢家文字纵向超出牌桌`);
  assert.equal(intersects(rects.message, rects.controls), false, `${label}: 赢家文字被操作区遮挡`);
  for (const seat of rects.seats) {
    assert.equal(intersects(rects.center, seat), false, `${label}: 结算时中央文字被 ${seat.name} 遮挡`);
    assert.equal(intersects(rects.controls, seat), false, `${label}: 结算时操作区遮挡 ${seat.name}`);
  }
  console.log(`✓ ${label} 桌面直接显示赢家与输赢（无弹窗）`);
}

async function detailCheck(label) {
  await page.click('#controls .btn-detail');
  await page.waitForFunction(() => {
    const overlay = document.querySelector('#resultOverlay');
    return overlay && getComputedStyle(overlay).display !== 'none' && document.querySelector('#btnContinue');
  }, { timeout: 10000 });
  const report = await page.evaluate(() => {
    const panel = document.querySelector('.result-panel');
    const overlay = document.querySelector('#resultOverlay');
    const button = document.querySelector('#btnContinue');
    const p = panel.getBoundingClientRect(), o = overlay.getBoundingClientRect(), b = button.getBoundingClientRect();
    return {
      panel: { left: p.left, top: p.top, right: p.right, bottom: p.bottom },
      overlay: { left: o.left, top: o.top, right: o.right, bottom: o.bottom },
      button: { top: b.top, bottom: b.bottom },
      rows: document.querySelectorAll('.result-row').length,
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight
    };
  });
  assert.equal(report.rows, 4, `${label}: 结算玩家人数不对`);
  assert.ok(report.panel.left >= report.overlay.left && report.panel.right <= report.overlay.right + 1, `${label}: 结算面板横向超出`);
  assert.ok(report.panel.top >= report.overlay.top && report.panel.bottom <= report.overlay.bottom + 1, `${label}: 结算面板纵向超出`);
  assert.ok(report.button.top >= report.panel.top && report.button.bottom <= report.panel.bottom + 1, `${label}: 继续按钮被遮挡`);
  assert.ok(report.scrollHeight <= report.clientHeight + 1, `${label}: 结算内容被裁切`);
  await page.click('#btnCloseDetail');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#resultOverlay')).display === 'none');
  console.log(`✓ ${label} 明细完整可见且可关闭`);
}

async function waitHuman() {
  await page.waitForFunction(() => !table.over && !presenting && !table.needsRunout && table.players[table.current]?.id === 'me', { timeout: 25000 });
}

async function normalHumanAction(fold = false) {
  if (fold) {
    await page.click('#controls .btn-fold');
    return;
  }
  // 面对超过 35% 筹码的下注直接弃牌，避免测试人类把把跟到破产触发“游戏结束”弹窗
  const risk = await page.evaluate(() => {
    const me = table.players.find(p => p.id === 'me');
    if (!me) return null;
    return { chips: me.chips, call: Math.max(0, table.highBet - me.bet), canCheck: table.legalActions(me).check };
  });
  if (risk && !risk.canCheck && risk.call > risk.chips * 0.35) {
    await page.click('#controls .btn-fold');
    return;
  }
  const check = page.locator('#controls button', { hasText: '过牌' });
  const call = page.locator('#controls button').filter({ hasText: /^跟注/ });
  if (await check.isVisible()) await check.click();
  else await call.click();
}

async function finishHand({ fold = false, allin = false } = {}) {
  let specialDone = false;
  const hand = await page.evaluate(() => table.handNo);
  for (let i = 0; i < 500; i++) {
    const state = await page.evaluate(() => ({ over: table.over, humanTurn: !presenting && !table.needsRunout && table.players[table.current]?.id === 'me' }));
    if (state.over) break;
    if (state.humanTurn) {
      if (allin && !specialDone) {
        const allinBtn = page.locator('#controls .btn-allin');
        if (await allinBtn.isVisible()) await allinBtn.click();
        else await page.evaluate(() => doAction({ type: 'allin' }));
        specialDone = true;
      }
      else await normalHumanAction(fold && !specialDone);
      specialDone = specialDone || fold;
    }
    await page.waitForTimeout(35);
  }
  await page.waitForFunction(h => table.handNo === h && table.over && !presenting, hand, { timeout: 25000 });
  return page.evaluate(() => ({ hand: table.handNo, log: table.log.map(x => x.msg), report: table.reconcileReport }));
}

await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await page.fill('#nick', '测试玩家');
await page.click('#btnOffline');
await waitHuman();
await page.evaluate(() => {
  window.__dispatched = [];
  const originalDispatch = dispatchLogLine;
  dispatchLogLine = (st, line) => { window.__dispatched.push({ hand: st.handNo, line }); return originalDispatch(st, line); };
  window.__ruleSnapshots = [];
  window.__flow = [];
  const originalAct = table.act.bind(table);
  table.act = (id, cmd) => {
    const hand = table.handNo, result = originalAct(id, cmd);
    window.__ruleSnapshots.push({ hand, id, cmd, stage: table.stage, highBet: table.highBet, maxBet: Math.max(...table.players.map(p => p.bet)) });
    window.__flow.push({ hand, kind: 'act', stage: table.stage, cards: table.community.length, over: table.over });
    return result;
  };
  const originalRunout = table.advanceRunout.bind(table);
  table.advanceRunout = () => {
    const hand = table.handNo, changed = originalRunout();
    window.__flow.push({ hand, kind: 'runout', stage: table.stage, cards: table.community.length, over: table.over });
    return changed;
  };
  window.__originalBotDecide = botDecide;
});

for (const [width, height, label] of [
  [390, 844, '390×844 竖屏'], [320, 568, '320×568 小屏竖屏'],
  [360, 640, '360×640 矮屏竖屏'], [414, 896, '414×896 大屏竖屏'],
  [844, 390, '844×390 横屏'], [616, 342, '616×342 横屏']
]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  await layoutCheck(label);
  const card = await page.evaluate(() => {
    const el = document.querySelector('.seat:not(.me) .cards .card');
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, font: parseFloat(getComputedStyle(el).fontSize) };
  });
  assert.ok(card.width >= 32, `${label}: 对手底牌被缩得过小`);
  assert.ok(Math.abs(card.height - card.width * 1.36) < 1, `${label}: 牌面宽高未按比例缩放`);
  assert.ok(Math.abs(card.font - card.width * 0.5) < 1, `${label}: 牌面文字未按牌宽缩放`);
  if (label === '390×844 竖屏') await page.screenshot({ path: join(tmpdir(), 'poker-portrait.png') });
  if (label === '616×342 横屏') await page.screenshot({ path: join(tmpdir(), 'poker-landscape.png') });
}
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const voiceUnlock = await page.evaluate(() => ({
  unlocked: AudioSys.voiceUnlocked,
  warmup: window.__speechEvents.find(e => e.volume === 0)
}));
assert.equal(voiceUnlock.unlocked, true, '用户手势未解锁语音');
assert.equal(voiceUnlock.warmup?.lang, 'zh-CN', '语音解锁不是中文');
assert.equal(voiceUnlock.warmup?.text, '。', '静音中文唤醒句缺失');
console.log('✓ 中文静音唤醒与语音解锁生效');

// 人类行动后，内部状态已到 AI，但焦点必须留在人类直到语音结束。
await normalHumanAction();
await page.waitForTimeout(400);
const duringVoice = await page.evaluate(() => ({
  active: document.querySelector('.seat.active .name')?.textContent,
  current: table.players[table.current]?.id,
  speaking: AudioSys.speaking,
  speech: window.__speechEvents.find(e => e.volume !== 0)
}));
assert.equal(duringVoice.active, '测试玩家', '语音未结束焦点提前移动');
assert.equal(duringVoice.current, 'b1');
assert.equal(duringVoice.speaking, true);
assert.equal(duringVoice.speech.end, null);
await page.waitForFunction(() => window.__speechEvents.filter(e => e.volume !== 0).length >= 2, { timeout: 10000 });
const speechTiming = await page.evaluate(() => window.__speechEvents.filter(e => e.volume !== 0).slice(0, 2));
assert.ok(speechTiming[0].end && speechTiming[1].start >= speechTiming[0].end, '下一位语音早于上一位结束');
console.log('✓ 当前玩家语音结束后才切换焦点并播下一位');

await page.evaluate(() => { window.__timeScale = 0.1; window.__speechDelay = 30; });
const hand1 = await finishHand();
assert.equal(hand1.report.ok, true);
await boardResultCheck('390×844 竖屏');
await detailCheck('390×844 竖屏');
await page.screenshot({ path: join(tmpdir(), 'poker-result-portrait.png') });

// 第二手：继续游戏不能重播上一手，重复 render 也不能重复播报。
const dispatchedBefore = await page.evaluate(() => window.__dispatched.length);
await page.click('#controls .btn-continue');
await page.waitForFunction(() => table.handNo === 2);
const replayCheck = await page.evaluate(() => {
  const before = window.__dispatched.length;
  render(); render(); render();
  return {
    before,
    after: window.__dispatched.length,
    oldHandLines: window.__dispatched.filter(x => x.hand < table.handNo).length
  };
});
assert.equal(replayCheck.before, replayCheck.after, '重复渲染造成重复播报');
assert.equal(replayCheck.oldHandLines, dispatchedBefore, '继续游戏重播了上一手文案');
console.log('✓ 继续游戏不重播旧文案，重复渲染不重复播报');
const hand2 = await finishHand({ fold: true });
assert.equal(hand2.report.ok, true);
await boardResultCheck('第二手');

// 第三手：AI 全部跟注，人类全下，必须依次展示 3/4/5 张公共牌。
await page.click('#controls .btn-continue');
await page.waitForFunction(() => table.handNo === 3);
await page.evaluate(() => { botDecide = () => ({ type: 'call' }); });
const hand3 = await finishHand({ allin: true });
assert.equal(hand3.report.ok, true);
const flow = await page.evaluate(() => {
  const seen = [];
  for (const f of window.__flow.filter(x => x.hand === 3)) {
    const key = `${f.stage}:${f.cards}:${f.over}`;
    if (seen.at(-1) !== key) seen.push(key);
  }
  return { seen, log: table.log.map(x => x.msg) };
});
const streetIndex = name => flow.log.findIndex(m => m.includes(`—— ${name} ——`));
assert.ok(streetIndex('翻牌') >= 0 && streetIndex('翻牌') < streetIndex('转牌') && streetIndex('转牌') < streetIndex('河牌'), '公共牌街道顺序错误');
assert.ok(flow.seen.indexOf('flop:3:false') >= 0, '未展示 3 张翻牌');
assert.ok(flow.seen.indexOf('flop:3:false') < flow.seen.indexOf('turn:4:false'), '翻牌与转牌未分街展示');
assert.ok(flow.seen.indexOf('turn:4:false') < flow.seen.indexOf('river:5:false'), '转牌与河牌未分街展示');
assert.ok(flow.seen.indexOf('river:5:false') < flow.seen.indexOf('showdown:5:true'), '河牌展示前就提前结算');
console.log('✓ 全下后逐街展示翻牌、转牌、河牌再结算');

await page.setViewportSize({ width: 616, height: 342 });
await page.waitForTimeout(350);
const busted3 = await page.evaluate(() => table.players.some(p => p.chips <= 0));
if (busted3) {
  // 单机同样“输光即结束”：应自动弹出“游戏结束”，且没有继续游戏按钮
  const go = await page.evaluate(() => ({
    visible: getComputedStyle(document.querySelector('#resultOverlay')).display !== 'none',
    title: document.querySelector('.result-title')?.textContent,
    controlText: document.querySelector('#controls .btn-continue')?.textContent || ''
  }));
  assert.equal(go.visible, true, '破产后未自动弹出明细');
  assert.equal(go.title, '游戏结束', '破产标题错误: ' + go.title);
  assert.notEqual(go.controlText, '继续游戏', '破产后不应再显示继续游戏');
  console.log('✓ 单机破产即结束，自动弹出游戏结束明细');
  // 后续用例继续跑：补足积分后重新渲染
  await page.evaluate(() => {
    detailOpen = false;
    document.querySelector('#resultOverlay').style.display = 'none';
    table.players.forEach(p => { if (p.chips <= 0) p.chips = 1000; });
    lastState = table.snapshot('me');
    render();
  });
  await page.waitForTimeout(200);
}
await boardResultCheck('616×342 横屏');
await detailCheck('616×342 横屏');
await page.screenshot({ path: join(tmpdir(), 'poker-result-landscape-616.png') });
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(350);
await boardResultCheck('844×390 横屏');
await detailCheck('844×390 横屏');
await page.screenshot({ path: join(tmpdir(), 'poker-result-landscape-844.png') });

// 第四手：一直加注也必须在有限动作内结束，并限制每条街的加注次数。
await page.click('#controls .btn-continue');
await page.waitForFunction(() => table.handNo === 4);
let guard4 = 0;
while (guard4++ < 400) {
  const s = await page.evaluate(() => ({
    over: table.over,
    humanTurn: !presenting && !table.needsRunout && table.players[table.current]?.id === 'me',
    raiseShown: (() => {
      const row = document.querySelector('#controls .raise-row');
      return !!row && getComputedStyle(row).display !== 'none';
    })()
  }));
  if (s.over) break;
  if (s.humanTurn) {
    if (s.raiseShown) await page.click('#controls .btn-raise');
    else await normalHumanAction();
  }
  await page.waitForTimeout(40);
}
const hand4 = await page.evaluate(() => ({
  over: table.over, report: table.reconcileReport,
  log: table.log.map(l => l.msg), maxRaises: table.maxRaises
}));
assert.equal(hand4.over, true, '一直加注未能结束牌局');
assert.equal(hand4.report.ok, true);
assert.ok(hand4.log.length < 90, `一直加注产生动作过多: ${hand4.log.length}`);
let street4 = 'preflop';
const raiseCount = {};
for (const line of hand4.log) {
  if (line.includes('—— 翻牌 ——')) street4 = 'flop';
  else if (line.includes('—— 转牌 ——')) street4 = 'turn';
  else if (line.includes('—— 河牌 ——')) street4 = 'river';
  if (/⬆/.test(line)) raiseCount[street4] = (raiseCount[street4] || 0) + 1;
}
for (const [streetName, count] of Object.entries(raiseCount)) {
  assert.ok(count <= hand4.maxRaises, `第4手 ${streetName} 加注 ${count} 次超过上限 ${hand4.maxRaises}`);
}
console.log('✓ 一直加注也能在有限动作内结束，每条街加注次数受限');

const snapshots = await page.evaluate(() => window.__ruleSnapshots);
for (const s of snapshots) assert.equal(s.highBet, s.maxBet, `第${s.hand}手 ${s.id} 行动后最高下注不一致`);
assert.deepEqual(errors, [], '浏览器控制台存在错误');
console.log('✓ 四手真实对局结束，最高下注始终一致，对账全部通过');
console.log('截图目录:', tmpdir());
await browser.close();
