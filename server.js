/* =====================================================================
 * server.js —— 权威房间服务：静态托管 + WebSocket 多人联机
 * 运行：npm install && node server.js ，默认端口 3000
 * ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Table, botDecide } = require('./src/game-core.js');

const PORT = process.env._FAAS_RUNTIME_PORT || process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SRC_DIR = path.join(__dirname, 'src');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

/* 快捷语白名单（与前端 public/app.js 的 EMOTE_TABS 并集保持一致） */
const EMOTES = ['哈哈，你输了！', '就这？再来！', '服不服？不服再来！', '承让承让，下把继续！', '赢你，我都不好意思了', '你出牌的样子像极了新手', '偷鸡成功，谢谢老板送池', '我就诈一下，你还真信了', '这牌你也弃？我啥都没有啊', '我牌不大，但我演技大', '你弃牌的样子，真可爱', '整个长沙、我是老大', '赢麻了，真的赢麻了', '你弃牌的速度，比发牌还快', '投降输一半', '你犹豫那一下，我就知道你没货', '不好意思，手气来了挡不住', '你加注的样子，像是在给我送钱', '牌没问题！', '快点，花儿都谢了！', '你出啊，我等着呢！', '别跑，大战300回合！', '我要验牌！', '你该请我吃饭，我送你赢的', '让你先高兴三分钟', '你最好一直这么走运', '这局不算，手滑了', '来啊，谁怕谁，梭哈', '我靠，我靠', '手气会转，别急着笑', '算你厉害', '算你走运', '再来，我不信邪', '你赢的是这一把，不是这一晚', '下一局，我连本带利', '我靠，这牌也能输？', '见鬼了', '我怀疑你作弊，但我没证据', '风水轮流转，等着', '菜且嘴硬，不服就干', '再来，我刚刚没认真', '演技不错'];

/* ---------- 静态文件 ---------- */
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let filePath = path.join(PUBLIC_DIR, urlPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // 兼容 /src 静态引用
    filePath = path.join(SRC_DIR, urlPath.replace(/^\/src\//, ''));
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache, must-revalidate' });
    res.end(data);
  });
});

/* ---------- 房间 ---------- */
const rooms = new Map();
let pidSeq = 1;

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = makeCode();
  const room = {
    code,
    table: new Table({ maxSeats: 4 }),
    sockets: new Map(), // pid -> ws
    owner: null,
    botSeq: 0,
    botTimer: null
  };
  rooms.set(code, room);
  return room;
}

function broadcast(room) {
  // 同一快照不重复广播，避免前端重复渲染/播报；快捷语随快照下发，保证断线/漏包也能收到
  const emote = room.lastEmote || null;
  const base = JSON.stringify({ ...room.table.snapshot(room.owner), e: emote && emote.seq });
  if (base === room._lastJson) return;
  room._lastJson = base;
  for (const [pid, ws] of room.sockets) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'state', state: { ...room.table.snapshot(pid), emote } }));
  }
}

/* ---------- AI 决策（服务端补位 bot） ---------- */
const BOT_STYLE = ['稳健', '机灵', '凶猛'];

function botAct(room, p) {
  const t = room.table;
  // 开局后补位、当前手还没发到底牌的 AI：本轮弃牌，下一手参与
  if (!p.hole || p.hole.length < 2) { t.act(p.id, { type: 'fold' }); return; }
  const la = t.legalActions(p);
  const stage = t.stage, cmd = botDecide(t, p);
  const r = t.act(p.id, cmd);
  if (r.ok && cmd.type === 'raise') {
    p.raiseCount = p.raiseStage === stage ? (p.raiseCount || 0) + 1 : 1;
    p.raiseStage = stage;
  }
  if (!r.ok) { if (la.check) t.act(p.id, { type: 'check' }); else if (la.call) t.act(p.id, { type: 'call' }); else t.act(p.id, { type: 'fold' }); }
}

function addBot(room) {
  room.botSeq++;
  const style = (room.botSeq - 1) % BOT_STYLE.length;
  const p = room.table.addPlayer({ id: 'b' + room.botSeq, name: 'AI·' + BOT_STYLE[style], isBot: true, personality: style });
  // 一手进行中补位的 AI：本轮旁观（下一手发牌后正常参与）
  if (p && !room.table.over) p.folded = true;
}

function scheduleBot(room) {
  if (room.table.over) { broadcast(room); return; }
  if (room.table.needsRunout) {
    if (room.botTimer) return;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      room.table.advanceRunout(); broadcast(room); scheduleBot(room);
    }, 1200);
    return;
  }
  const p = room.table.players[room.table.current];
  if (p && p.isBot) {
    if (room.botTimer) return; // 已有待触发的 AI 调度，避免多条调度链导致同一 AI 重复行动
    // 给前端足够时间播完上一个 AI 的声音和气泡
    const think = 3200;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      botAct(room, p); broadcast(room); scheduleBot(room);
    }, think);
  }
  // 轮到人类时不在此重复广播：状态由对应动作/开局的广播点下发，避免同一状态重复推送
}

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server });

/* 空闲连接清理：超过 120s 无任何消息的连接直接终止，避免半开连接长期占着座位 */
setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    if (ws._lastSeen && now - ws._lastSeen > 120000) { try { ws.terminate(); } catch (e) {} }
  }
}, 30000);

wss.on('connection', (ws) => {
  let pid = null, room = null;
  ws._lastSeen = Date.now();

  ws.send(JSON.stringify({ type: 'connected' }));

  ws.on('message', (raw) => {
    ws._lastSeen = Date.now();
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }

    if (msg.type === 'create') {
      room = createRoom();
      pid = 'u' + pidSeq++;
      const p = room.table.addPlayer({ id: pid, name: msg.name || '玩家', isHuman: true });
      room.owner = pid;
      room.sockets.set(pid, ws);
      ws.send(JSON.stringify({ type: 'room', code: room.code, pid, owner: room.owner }));
      broadcast(room);
      return;
    }

    if (msg.type === 'join') {
      room = rooms.get((msg.code || '').toUpperCase());
      if (!room) return ws.send(JSON.stringify({ type: 'error', error: '房间不存在' }));
      // 断线重连：沿用原座位（不新增玩家），并把新连接绑定到同一 pid
      const rp = msg.resume ? room.table.players.find(x => x.id === msg.resume) : null;
      if (rp) {
        pid = rp.id;
        room.sockets.set(pid, ws);
        rp.isHuman = true;
        // 断线后刷新重连：若仍是自己的回合，撤销因断开被自动置的弃牌，让玩家接续操作
        if (!room.table.over && room.table.players[room.table.current] && room.table.players[room.table.current].id === pid) rp.folded = false;
        ws.send(JSON.stringify({ type: 'room', code: room.code, pid, owner: room.owner, resumed: true }));
        ws.send(JSON.stringify({ type: 'state', state: room.table.snapshot(pid) }));
        scheduleBot(room);
        return;
      }
      if (room.table.players.length >= room.table.maxSeats) return ws.send(JSON.stringify({ type: 'error', error: '房间已满' }));
      pid = 'u' + pidSeq++;
      const np = room.table.addPlayer({ id: pid, name: msg.name || '玩家', isHuman: true });
      // 牌局进行中加入：本手旁观，下一手参与
      if (np && !room.table.over) np.folded = true;
      room.sockets.set(pid, ws);
      ws.send(JSON.stringify({ type: 'room', code: room.code, pid, owner: room.owner }));
      broadcast(room);
      return;
    }

    if (!room || !pid) return;

    if (msg.type === 'add-bot') {
      if (room.table.players.length >= room.table.maxSeats) return;
      addBot(room);
      broadcast(room);
      return;
    }

    if (msg.type === 'emote') {
      // 允许白名单快捷语与玩家自输入短语：去首尾空格、限长 40，配合限频防刷屏/超长广播
      const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 40) : '';
      if (!text) return;
      const p = room.table.byId(pid);
      if (!p) return;
      if (Date.now() - (ws._lastEmoteAt || 0) < 1200) return;
      ws._lastEmoteAt = Date.now();
      // 写进房间快照再广播：所有人都在下一次 state 里收到（含发送者自己用于去重）
      room.lastEmote = { seq: (room.emoteSeq = (room.emoteSeq || 0) + 1), pid, name: p.name, text, at: Date.now() };
      broadcast(room);
      return;
    }

    if (msg.type === 'voice') {
      // 语音留言：一次性广播（不进快照，避免 state 包被音频撑大）；限时长 21s、大小 240KB（base64）、mime 白名单，2 秒限频
      const data = typeof msg.data === 'string' ? msg.data : '';
      const dur = +msg.dur || 0;
      const mimeOk = typeof msg.mime === 'string' && /^audio\/(webm|mp4|ogg|aac|mpeg)/.test(msg.mime);
      if (!data || data.length > 240000 || dur <= 0 || dur > 21000 || !mimeOk) return;
      const p = room.table.byId(pid);
      if (!p) return;
      if (Date.now() - (ws._lastVoiceAt || 0) < 2000) return;
      ws._lastVoiceAt = Date.now();
      const payload = { seq: (room.voiceSeq = (room.voiceSeq || 0) + 1), pid, name: p.name, mime: msg.mime, dur, data };
      let delivered = 0;
      for (const [rpid, sock] of room.sockets) {
        if (sock.readyState === 1 && rpid !== pid) { sock.send(JSON.stringify({ type: 'voice', voice: payload })); delivered++; }
      }
      // 回执给发送者：直接看到语音送达了几位玩家
      try { ws.send(JSON.stringify({ type: 'voice-ack', count: delivered })); } catch (e) {}
      return;
    }

    if (msg.type === 'kick-bot') {
      // 有人类加入后可踢走一个 AI；中途不能踢，避免破坏当前手牌
      if (!room.table.over) return ws.send(JSON.stringify({ type: 'error', error: '本手结束后再踢走 AI' }));
      const bot = room.table.players.find(p => p.isBot);
      if (!bot) return;
      room.table.players = room.table.players.filter(p => p.id !== bot.id);
      if (room.table.dealer >= room.table.players.length) room.table.dealer = 0;
      room.table.current = null;
      broadcast(room);
      return;
    }

    if (msg.type === 'start') {
      // 一手未结束时忽略重复/迟到开局请求，避免中途重开
      if (!room.table.over) return;
      if (room.table.players.length < 2) {
        // 自动补 bot 凑够 2 人
        while (room.table.players.length < 2) addBot(room);
      }
      room.table.startHand();
      broadcast(room);
      scheduleBot(room);
      return;
    }

    if (msg.type === 'reset') {
      // 有人破产、游戏结束后重新开始：所有玩家积分清零再开下一手
      if (!room.table.over) return;
      room.table.resetGame();
      room.table.startHand();
      broadcast(room);
      scheduleBot(room);
      return;
    }

    if (msg.type === 'action') {
      const r = room.table.act(pid, msg.action);
      if (!r.ok) return ws.send(JSON.stringify({ type: 'error', error: r.error }));
      broadcast(room); // 先立即广播人类动作结果，界面即时反馈，再安排 AI
      scheduleBot(room);
      return;
    }
  });

  ws.on('close', () => {
    if (!room || !pid) return;
    if (room.sockets.get(pid) !== ws) return; // 已被新连接接管，忽略旧连接关闭
    const p = room.table.byId(pid);
    if (p && !room.table.over) { p.folded = true; p.isHuman = false; }
    room.sockets.delete(pid);
    broadcast(room);
    // 空房间清理（保留 10 分钟，方便移动端切换应用后重连）
    if (room.sockets.size === 0) setTimeout(() => { if (rooms.get(room.code) && room.sockets.size === 0) rooms.delete(room.code); }, 600000);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`♠ 欢乐牌局服务已启动: http://0.0.0.0:${PORT}`);
});
