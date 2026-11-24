/* =====================================================================
 * server.js —— 权威房间服务：静态托管 + WebSocket 多人联机
 * 运行：npm install && node server.js ，默认端口 3000
 * ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Table } = require('./src/poker-core.js');

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
function botStrength(table, p) {
  if (table.community.length === 0) {
    const [a, b] = p.hole.map(c => c.rank).sort((x, y) => y - x);
    let s = a === b ? (a >= 11 ? 0.85 : a >= 7 ? 0.7 : 0.5) : (a >= 13 ? 0.55 : a >= 10 ? 0.45 : 0.3);
    if (p.hole[0].suit === p.hole[1].suit) s += 0.1;
    return Math.min(1, s);
  }
  const h = require('./src/poker-core.js').bestHand([...p.hole, ...table.community]);
  const base = [0.15, 0.3, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1][h[0]];
  return Math.min(1, base + Math.random() * 0.15);
}

function botAct(room, p) {
  const t = room.table;
  const s = botStrength(t, p);
  const callAmt = t.highBet - p.bet;
  const la = t.legalActions(p);
  let cmd;
  if (callAmt === 0) cmd = s > 0.62 ? { type: 'raise', to: t.highBet + t.minRaise } : { type: 'check' };
  else if (s > 0.78) cmd = { type: 'raise', to: t.highBet + t.minRaise };
  else if (s > 0.5) cmd = { type: 'call' };
  else if (Math.random() < 0.08) cmd = { type: 'call' };
  else cmd = { type: 'fold' };
  const r = t.act(p.id, cmd);
  if (!r.ok) { if (la.call) t.act(p.id, { type: 'call' }); else t.act(p.id, { type: 'fold' }); }
}

function scheduleBot(room) {
  if (room.table.over) { broadcast(room); return; }
  const p = room.table.players[room.table.current];
  if (p && p.isBot) {
    setTimeout(() => { botAct(room, p); broadcast(room); scheduleBot(room); }, 600);
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
      room.botSeq++;
      room.table.addPlayer({ id: 'b' + room.botSeq, name: 'AI-' + room.botSeq, isBot: true });
      broadcast(room);
      return;
    }

    if (msg.type === 'start') {
      if (room.table.players.length < 2) {
        // 自动补 bot 凑够 2 人
        while (room.table.players.length < 2) {
          room.botSeq++;
          room.table.addPlayer({ id: 'b' + room.botSeq, name: 'AI-' + room.botSeq, isBot: true });
        }
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

server.listen(PORT, () => {
  console.log(`♠ 德州扑克服务已启动: http://localhost:${PORT}`);
});
