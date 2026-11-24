/* 联机集成测试：起服务端，两个客户端创建/加入房间，走完一手，校验对账 */
const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');

const PORT = 3999;
const server = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT }, stdio: 'ignore' });

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, pid: null, code: null, state: null, waiters: [] };
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.type === 'room') { c.pid = msg.pid; c.code = msg.code; }
    if (msg.type === 'state') { c.state = msg.state; }
    c.waiters.forEach(w => w(msg));
  });
  c.send = o => ws.send(JSON.stringify(o));
  c.onMsg = fn => c.waiters.push(fn);
  c.ready = () => new Promise(res => {
    if (ws.readyState === 1) return res();
    ws.on('open', res);
  });
  return c;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await sleep(800);
  const A = client(), B = client();
  await A.ready(); await B.ready();

  A.send({ type: 'create', name: '甲' });
  await new Promise(res => A.onMsg(m => m.type === 'room' && res()));
  B.send({ type: 'join', code: A.code, name: '乙' });
  await new Promise(res => B.onMsg(m => m.type === 'room' && res()));

  console.log('房间', A.code, '玩家', A.pid, B.pid);
  A.send({ type: 'start' });

  // 人类策略：能过牌就过牌，否则跟注到底，保证牌局走完
  function maybeAct(c) {
    const st = c.state;
    if (!st || st.over) return;
    const me = st.players.find(p => p.id === c.pid);
    if (!me || me.folded || me.allin || st.current !== me.id) return;
    const callAmt = Math.max(0, st.highBet - me.bet);
    if (callAmt === 0) c.send({ type: 'action', action: { type: 'check' } });
    else c.send({ type: 'action', action: { type: 'call' } });
  }
  A.onMsg(() => maybeAct(A));
  B.onMsg(() => maybeAct(B));

  // 等待结束
  let guard = 0;
  while (guard < 60) {
    await sleep(500); guard++;
    if (A.state && A.state.over && B.state && B.state.over) break;
  }

  const st = A.state;
  console.log('结束阶段:', st.stage, '底池:', st.pot, '对账:', st.report && st.report.ok);
  if (!st) throw new Error('未收到状态');
  if (!st.over) throw new Error('牌局未结束');
  if (st.pot !== 0) throw new Error('底池残留 ' + st.pot);
  if (!st.report || !st.report.ok) {
    console.log('对账失败:', JSON.stringify(st.report, null, 2));
    throw new Error('对账未通过');
  }
  // 两客户端玩家数一致（投影一致）
  if (A.state.players.length !== B.state.players.length) throw new Error('两端状态不一致');

  console.log('✓ 联机一手跑通，对账通过，两端状态一致');
  server.kill();
  process.exit(0);
})().catch(e => { console.error('✗', e.message); server.kill(); process.exit(1); });
