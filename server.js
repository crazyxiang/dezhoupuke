/* =====================================================================
 * server.js —— 权威房间服务：静态托管 + WebSocket 多人联机
 * 运行：npm install && node server.js ，默认端口 3000
 * ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Table, bestHand } = require('./src/game-core.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SRC_DIR = path.join(__dirname, 'src');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
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
    botSeq: 0
  };
  rooms.set(code, room);
  return room;
}

function broadcast(room) {
  for (const [pid, ws] of room.sockets) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'state', state: room.table.snapshot(pid) }));
  }
}

/* ---------- AI 决策（服务端补位 bot） ---------- */
const BOT_STYLE = ['稳健', '机灵', '凶猛'];

function handStrength(t, p) {
  if (t.community.length === 0) {
    const [a, b] = p.hole.map(c => c.rank).sort((x, y) => y - x);
    let s;
    if (a === b) s = a >= 11 ? 0.88 : a >= 8 ? 0.74 : 0.58;
    else {
      s = 0.3 + ((a - 2) / 12) * 0.35;
      if (a === 14) s += 0.08;
      if (p.hole[0].suit === p.hole[1].suit) s += 0.1;
      if (Math.abs(a - b) === 1) s += 0.06;
      else if (Math.abs(a - b) <= 2) s += 0.03;
    }
    return Math.min(1, Math.max(0, s));
  }
  const h = bestHand([...p.hole, ...t.community]);
  const base = [0.18, 0.34, 0.46, 0.56, 0.66, 0.76, 0.86, 0.95, 1][h[0]];
  let draw = 0;
  const all = t.community.concat(p.hole);
  const suitCnt = {}; all.forEach(c => suitCnt[c.suit] = (suitCnt[c.suit] || 0) + 1);
  if (Object.values(suitCnt).some(n => n >= 4)) draw += 0.1;
  return Math.min(1, base + draw + Math.random() * 0.08);
}

function botDecide(t, p) {
  const s = handStrength(t, p);
  const call = t.highBet - p.bet;
  const style = p.personality == null ? 1 : p.personality;
  const r = Math.random();
  const bluff = style === 2 ? 0.14 : style === 0 ? 0.05 : 0.09;
  const raiseTh = style === 2 ? 0.58 : 0.66;
  const callTh = style === 0 ? 0.46 : 0.40;
  if (call === 0) {
    if (s > raiseTh || (r < bluff && s > 0.35)) return { type: 'raise', to: t.highBet + t.minRaise };
    return { type: 'check' };
  }
  if (s > 0.74 || (style === 2 && s > 0.6 && r < 0.5)) return { type: 'raise', to: t.highBet + t.minRaise };
  if (s > callTh || r < bluff * 0.5) return { type: 'call' };
  return { type: 'fold' };
}

function botAct(room, p) {
  const t = room.table;
  const la = t.legalActions(p);
  const cmd = botDecide(t, p);
  const r = t.act(p.id, cmd);
  if (!r.ok) { if (la.call) t.act(p.id, { type: 'call' }); else t.act(p.id, { type: 'fold' }); }
}

function addBot(room) {
  room.botSeq++;
  const style = (room.botSeq - 1) % BOT_STYLE.length;
  room.table.addPlayer({ id: 'b' + room.botSeq, name: 'AI·' + BOT_STYLE[style], isBot: true, personality: style });
}

function scheduleBot(room) {
  if (room.table.over) { broadcast(room); return; }
  const p = room.table.players[room.table.current];
  if (p && p.isBot) {
    setTimeout(() => { botAct(room, p); broadcast(room); scheduleBot(room); }, 1300);
  } else {
    broadcast(room);
  }
}

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let pid = null, room = null;

  ws.send(JSON.stringify({ type: 'connected' }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

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
      if (room.table.players.length >= room.table.maxSeats) return ws.send(JSON.stringify({ type: 'error', error: '房间已满' }));
      pid = 'u' + pidSeq++;
      room.table.addPlayer({ id: pid, name: msg.name || '玩家', isHuman: true });
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

    if (msg.type === 'start') {
      if (room.table.players.length < 2) {
        // 自动补 bot 凑够 2 人
        while (room.table.players.length < 2) addBot(room);
      }
      room.table.startHand();
      scheduleBot(room);
      return;
    }

    if (msg.type === 'action') {
      const r = room.table.act(pid, msg.action);
      if (!r.ok) return ws.send(JSON.stringify({ type: 'error', error: r.error }));
      scheduleBot(room);
      return;
    }
  });

  ws.on('close', () => {
    if (!room || !pid) return;
    const p = room.table.byId(pid);
    if (p && !room.table.over) { p.folded = true; p.isHuman = false; }
    room.sockets.delete(pid);
    broadcast(room);
    // 空房间清理
    if (room.sockets.size === 0) setTimeout(() => { if (rooms.get(room.code) && room.sockets.size === 0) rooms.delete(room.code); }, 60000);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`♠ 欢乐牌局服务已启动: http://0.0.0.0:${PORT}`);
});
