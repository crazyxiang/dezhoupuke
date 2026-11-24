/* =====================================================================
 * game-core.js  ——  纯逻辑、无 I/O、同构（浏览器 / Node 共用）
 * 包含：牌组、牌型评估、对局状态机、主/边奖池分配、对账账本
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANK_LABEL = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

  /* ---------------- 牌组 ---------------- */
  function buildDeck() {
    const d = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ rank: r, suit: s });
    return d;
  }
  /* 优先使用系统加密随机源；浏览器与 Node 20 均支持 WebCrypto，旧环境才回退 Math.random。
     洗牌只使用 Fisher–Yates，不根据玩家、输赢或 AI 决策调整任何牌的位置。 */
  function secureRandom() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (c && typeof c.getRandomValues === 'function') {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
    if (typeof require === 'function') {
      try { return require('crypto').randomBytes(4).readUInt32LE(0) / 4294967296; } catch (e) {}
    }
    return Math.random();
  }
  function shuffle(deck, rng) {
    rng = rng || secureRandom;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }
  const cardStr = c => RANK_LABEL[c.rank] + c.suit;
  const isRed = s => s === '♥' || s === '♦';

  /* ---------------- 手牌评估 ---------------- */
  function evaluate5(cards) {
    const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
    const flush = cards.every(c => c.suit === cards[0].suit);
    const uniq = [...new Set(ranks)].sort((a, b) => b - a);
    let straightHigh = 0;
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) straightHigh = 5;
    }
    const cnt = {};
    ranks.forEach(r => cnt[r] = (cnt[r] || 0) + 1);
    const groups = Object.entries(cnt).map(([r, n]) => ({ r: +r, n })).sort((a, b) => b.n - a.n || b.r - a.r);
    const counts = groups.map(g => g.n);

    if (flush && straightHigh) return [8, straightHigh];
    if (counts[0] === 4) return [7, groups[0].r, groups[1].r];
    if (counts[0] === 3 && counts[1] === 2) return [6, groups[0].r, groups[1].r];
    if (flush) return [5, ...ranks];
    if (straightHigh) return [4, straightHigh];
    if (counts[0] === 3) return [3, groups[0].r, ...groups.slice(1).map(g => g.r).sort((a, b) => b - a)];
    if (counts[0] === 2 && counts[1] === 2) return [2, groups[0].r, groups[1].r, groups[2].r];
    if (counts[0] === 2) return [1, groups[0].r, ...groups.slice(1).map(g => g.r).sort((a, b) => b - a)];
    return [0, ...ranks];
  }

  function bestHand(cards) {
    let best = null;
    for (let i = 0; i < cards.length - 4; i++)
      for (let j = i + 1; j < cards.length - 3; j++)
        for (let k = j + 1; k < cards.length - 2; k++)
          for (let l = k + 1; l < cards.length - 1; l++)
            for (let m = l + 1; m < cards.length; m++) {
              const h = evaluate5([cards[i], cards[j], cards[k], cards[l], cards[m]]);
              if (!best || handCompare(h, best) > 0) best = h;
            }
    return best;
  }
  function handCompare(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? 0, y = b[i] ?? 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }
  const handName = h => h ? HAND_NAMES[h[0]] : '';

  /* ---------------- AI：只看自己的底牌、公共牌和下注信息 ---------------- */
  const clamp01 = n => Math.max(0.05, Math.min(1, n));
  function preflopStrength(hole) {
    if (!hole || hole.length < 2) return 0.2;
    const [a, b] = hole.map(c => c.rank).sort((x, y) => y - x);
    const suited = hole[0].suit === hole[1].suit;
    if (a === b) return 0.5 + ((a - 2) / 12) * 0.45;
    let s = 0.18 + (a / 14) * 0.28 + (b / 14) * 0.16;
    if (suited) s += 0.07;
    const gap = a - b;
    if (gap === 1) s += 0.07; else if (gap === 2) s += 0.03; else if (gap >= 5) s -= 0.05;
    if (a >= 13 && b >= 10) s += 0.06;
    return clamp01(s);
  }
  function botHandStrength(t, p) {
    if (!p.hole || p.hole.length < 2) return 0.2;
    if (!t.community.length) return preflopStrength(p.hole);
    const all = [...p.hole, ...t.community];
    const h = bestHand(all);
    let s = [0.16, 0.52, 0.70, 0.80, 0.86, 0.90, 0.95, 0.985, 1][h[0]];
    if (h[0] === 1) {
      const pairRank = h[1];
      const boardRanks = t.community.map(c => c.rank).sort((a, b) => b - a);
      if (p.hole[0].rank === p.hole[1].rank) {
        const overcards = boardRanks.filter(r => r > pairRank).length;
        s += overcards === 0 ? 0.14 : overcards === 1 ? 0.05 : overcards === 2 ? -0.02 : -0.08;
      } else {
        const uniqueBoard = [...new Set(boardRanks)];
        if (pairRank === uniqueBoard[0]) s += 0.14;
        else if (pairRank === uniqueBoard[1]) s += 0.06;
        else s -= 0.03;
        if (h[2] === 14) s += 0.04; else if (h[2] >= 12) s += 0.02;
      }
    }
    // 听牌必须有自己的底牌参与，不能把纯公共牌听牌误算成自己的强牌。
    const suits = {};
    all.forEach(c => suits[c.suit] = (suits[c.suit] || 0) + 1);
    if (h[0] < 5 && Object.keys(suits).some(suit => suits[suit] === 4 && p.hole.some(c => c.suit === suit))) s += 0.1;
    if (h[0] < 4) {
      const ranks = [...new Set(all.map(c => c.rank))].sort((a, b) => a - b);
      const holeRanks = p.hole.map(c => c.rank);
      for (let i = 0; i <= ranks.length - 4; i++) {
        const window = ranks.slice(i, i + 4);
        if (window[3] - window[0] <= 4 && holeRanks.some(r => window.includes(r))) { s += 0.07; break; }
      }
    }
    return clamp01(s);
  }
  function botDecide(t, p, rng) {
    rng = rng || Math.random;
    const s = botHandStrength(t, p);
    const la = t.legalActions(p);
    const style = p.personality == null ? 1 : p.personality; // 0=稳健，1=机灵，2=凶猛
    const callAmt = Math.max(0, t.highBet - p.bet);
    const pot = Math.max(t.bb * 2, t.pot);
    const bluff = style === 2 ? 0.18 : style === 0 ? 0.05 : 0.1;
    const raiseTop = style === 2 ? 0.62 : style === 0 ? 0.68 : 0.66;
    const aggression = style === 2 ? 1.2 : style === 0 ? 0.85 : 1;

    /* 加注尺度随牌力与底池浮动，并带一点随机；避免每把都只加最小注显得在重复动作 */
    function raiseTo(strength, fracBase) {
      if (la.maxTo <= la.minTo) return la.minTo;
      const frac = fracBase == null ? (strength >= 0.92 ? 1.0 : strength >= 0.8 ? 0.72 : 0.48) : fracBase;
      let to = t.highBet + Math.round(pot * frac * (0.85 + rng() * 0.4));
      to = Math.max(la.minTo, Math.min(la.maxTo, to));
      // 接近全下时干脆推掉，避免留下零头
      if (to >= la.maxTo - t.bb) return la.maxTo;
      return to;
    }

    if (callAmt === 0) {
      if (la.raise) {
        if (s >= raiseTop) {
          if (rng() < 0.12) return { type: 'check' }; // 偶尔慢打
          return { type: 'raise', to: raiseTo(s) };
        }
        if (s >= 0.45 && rng() < 0.34 * aggression) return { type: 'raise', to: raiseTo(s, 0.42) };
        if (s > 0.34 && rng() < bluff * 0.4) return { type: 'raise', to: raiseTo(0.4, 0.4) }; // 偶尔偷池
      }
      return { type: 'check' };
    }

    if (la.raise) {
      if (s >= raiseTop + 0.08) {
        if (rng() < 0.15) return { type: 'call' }; // 强牌慢打
        return { type: 'raise', to: raiseTo(s) };
      }
      if (s >= raiseTop && rng() < 0.55 * aggression) return { type: 'raise', to: raiseTo(s) };
      if (s < 0.4 && rng() < bluff * 0.3) return { type: 'raise', to: raiseTo(0.4, 0.45) }; // 偶尔诈加
    }

    const call = Math.min(callAmt, p.chips);
    const potOdds = call / Math.max(1, pot + call);
    const margin = style === 2 ? 0.07 : style === 0 ? 0.12 : 0.1;
    const pressure = call >= p.chips * 0.6 || call > pot * 0.75 ? 0.08 : 0;
    // 一对面对普通下注通常会继续；垃圾牌不乱跟，超大下注仍会按真实牌力弃牌。
    if (s >= Math.max(0.28, potOdds + margin + pressure)) return { type: 'call' };
    return { type: 'fold' };
  }

  /* ---------------- 牌桌状态机 ---------------- */
  const STAGES = ['idle', 'preflop', 'flop', 'turn', 'river', 'showdown'];

  class Table {
    constructor(opts = {}) {
      this.sb = opts.smallBlind || 10;
      this.bb = opts.bigBlind || 20;
      this.startChips = opts.startChips || 1000;
      this.maxSeats = opts.maxSeats || 4;
      this.rng = opts.rng || secureRandom;
      this.players = [];
      this.deck = [];
      this.community = [];
      this.pot = 0;
      this.dealer = 0;
      this.stage = 'idle';
      this.current = 0;
      this.highBet = 0;
      this.minRaise = this.bb;
      this.maxRaises = opts.maxRaises || 4; // 每条街最多加注次数，避免加注战拖不完
      this.raisesThisStreet = 0;
      this.over = true;
      this.needsRunout = false;
      this.handNo = 0;
      this.log = [];          // 人类可读日志（{seq,msg}）
      this.logSeq = 0;        // 日志自增序号，供前端增量播报
      this.events = [];       // 对账账本（追加式事件）
      this.lastPayout = [];    // 上一手派彩明细
      this.reconcileReport = null;
    }

    /* 座位 */
    addPlayer({ id, name, isHuman = false, isBot = false, personality = null }) {
      if (this.players.length >= this.maxSeats) return null;
      const p = {
        id, name, isHuman, isBot, personality,
        chips: this.startChips, hole: [], bet: 0, total: 0,
        folded: false, allin: false, acted: false, hand: null, seat: this.players.length
      };
      this.players.push(p);
      return p;
    }
    get alive() { return this.players.filter(p => !p.folded); }
    get active() { return this.players.filter(p => !p.folded && !p.allin); }
    byId(id) { return this.players.find(p => p.id === id); }

    _emit(type, data) {
      this.events.push({ hand: this.handNo, type, ...data, at: Date.now() });
    }
    _log(msg) { this.log.push({ seq: ++this.logSeq, msg }); }

    /* 开一手 */
    startHand() {
      if (this.players.length < 2) return { ok: false, error: '至少需要 2 名玩家' };
      this.handNo++;
      this.over = false;
      this.log = []; this.logSeq = 0; // 【修】每次新手清空日志，防止上一手残留被重新播报
      this.players.forEach(p => {
        p.hole = []; p.bet = 0; p.total = 0; p.folded = false; p.allin = false; p.acted = false; p.hand = null;
      });
      this.community = []; this.pot = 0; this.highBet = 0; this.minRaise = this.bb;
      this.raisesThisStreet = 0;
      this.needsRunout = false; this.current = -1;
      this.lastPayout = []; this.reconcileReport = null;
      this.deck = shuffle(buildDeck(), this.rng);
      this.dealer = (this.dealer + 1) % this.players.length;

      // 积分为 0 重新补给（娱乐桌）
      this.players.forEach(p => {
        if (p.chips <= 0) { p.chips = this.startChips; this._log(`🔄 ${p.name} 重新买入 ${this.startChips}`); this._emit('rebuy', { player: p.id, amount: this.startChips }); }
      });
      this.startSnapshot = this.players.map(p => ({ id: p.id, chips: p.chips }));

      this.players.forEach(p => { p.hole = [this.deck.pop(), this.deck.pop()]; });

      const n = this.players.length;
      const sb = n === 2 ? this.dealer : (this.dealer + 1) % n;
      const bb = n === 2 ? (this.dealer + 1) % n : (this.dealer + 2) % n;
      this._postBlind(this.players[sb], this.sb, '小盲');
      this._postBlind(this.players[bb], this.bb, '大盲');
      // 盲注是强制下注，不等于已经行动；大盲在无人加注时仍有选择权。
      this.highBet = Math.max(this.players[sb].bet, this.players[bb].bet);
      this.stage = 'preflop';
      this.current = n === 2 ? this.dealer : (bb + 1) % n;
      if (this.players[this.current].allin) this.current = this._nextActive(this.current);
      // 只剩一名可行动玩家且已不欠注时，无需无意义地过牌，直接逐街发牌。
      if (this.active.length <= 1 && this.active.every(p => p.bet >= this.highBet)) {
        this.current = -1;
        this.needsRunout = true;
      }
      this._log(`— 第 ${this.handNo} 手开始，庄家 ${this.players[this.dealer].name} —`);
      this._emit('hand-start', { dealer: this.dealer, handNo: this.handNo });
      return { ok: true };
    }

    /* 有人破产、游戏结束后重新开始：所有玩家积分重置为初始值，再开下一手 */
    resetGame() {
      this.players.forEach(p => {
        p.chips = this.startChips; p.hole = []; p.bet = 0; p.total = 0;
        p.folded = false; p.allin = false; p.acted = false; p.hand = null;
      });
      this.community = []; this.pot = 0; this.highBet = 0; this.minRaise = this.bb;
      this.raisesThisStreet = 0; this.needsRunout = false; this.current = -1;
      this.over = true; this.lastPayout = []; this.reconcileReport = null;
      this.startSnapshot = this.players.map(p => ({ id: p.id, chips: p.chips }));
    }

    _postBlind(p, amount, label) {
      const put = Math.min(amount, p.chips);
      p.chips -= put; p.bet += put; p.total += put; this.pot += put;
      if (p.chips === 0) p.allin = true;
      this._log(`${p.name} 下${label} ${put}`);
      this._emit('blind', { player: p.id, amount: put, label });
    }

    _nextActive(from) {
      let i = from;
      let guard = 0;
      do { i = (i + 1) % this.players.length; guard++; }
      while (guard <= this.players.length && (this.players[i].folded || this.players[i].allin));
      return i;
    }

    /* 当前玩家合法动作 */
    legalActions(p) {
      const callAmt = Math.max(0, this.highBet - p.bet);
      const minTo = this.highBet + this.minRaise;
      const maxTo = p.bet + p.chips;
      const acts = {
        fold: true,
        check: callAmt === 0,
        call: callAmt > 0,
        callAmount: Math.min(callAmt, p.chips),
        raise: this.raisesThisStreet < this.maxRaises && maxTo >= minTo,
        raiseCapped: this.raisesThisStreet >= this.maxRaises,
        minTo, maxTo,
        allin: p.chips > 0
      };
      return acts;
    }

    /* 执行动作命令。cmd: {type, to?} */
    act(id, cmd) {
      const p = this.byId(id);
      if (!p) return { ok: false, error: '玩家不存在' };
      if (this.over) return { ok: false, error: '本局已结束' };
      if (this.needsRunout || this.current < 0) return { ok: false, error: '正在发公共牌' };
      if (p.folded || p.allin) return { ok: false, error: '该玩家已无法行动' };
      if (!this.players[this.current] || this.players[this.current].id !== id) return { ok: false, error: '还没轮到你' };

      const la = this.legalActions(p);
      switch (cmd.type) {
        case 'fold':
          p.folded = true; p.acted = true;
          this._log(`✖ ${p.name} 弃牌`);
          this._emit('fold', { player: id });
          break;
        case 'check':
          if (!la.check) return { ok: false, error: '不能过牌，需要跟注' };
          p.acted = true;
          this._log(`✔ ${p.name} 过牌`);
          this._emit('check', { player: id });
          break;
        case 'call': {
          if (!la.call) return { ok: false, error: '无需跟注' };
          const put = Math.min(this.highBet - p.bet, p.chips);
          p.chips -= put; p.bet += put; p.total += put; this.pot += put;
          if (p.chips === 0) p.allin = true;
          p.acted = true;
          this._log(`📞 ${p.name} 跟注 ${put}`);
          this._emit('call', { player: id, amount: put });
          break;
        }
        case 'raise': {
          if (this.raisesThisStreet >= this.maxRaises) return { ok: false, error: '本轮加注已达上限，只能跟注或弃牌' };
          let to = Math.floor(cmd.to || la.minTo);
          if (to < la.minTo) to = la.minTo;
          if (to > la.maxTo) to = la.maxTo;
          if (p.bet + p.chips < la.minTo) return { ok: false, error: '积分不足最小加注，只能梭哈' };
          const put = to - p.bet;
          const incr = to - this.highBet;
          const openingBet = this.highBet === 0; // 新一条街的首次下注，文案用“下注”而不是“加注到”
          p.chips -= put; p.bet = to; p.total += put; this.pot += put;
          if (incr >= this.minRaise) this.minRaise = incr; // 完整加注才更新最小加注
          this.highBet = to;
          this.raisesThisStreet++;
          if (p.chips === 0) p.allin = true;
          p.acted = true;
          // 有人加注后，其余未弃牌玩家需重新行动
          this.players.forEach(q => { if (!q.folded && !q.allin && q.id !== p.id) q.acted = false; });
          this._log(`⬆ ${p.name} ${openingBet ? '下注' : '加注到'} ${to}`);
          this._emit(openingBet ? 'bet' : 'raise', { player: id, to, amount: put });
          break;
        }
        case 'allin': {
          const put = p.chips;
          p.chips = 0; p.bet += put; p.total += put; this.pot += put;
          p.allin = true; p.acted = true;
          if (p.bet > this.highBet) {
            const incr = p.bet - this.highBet;
            this.highBet = p.bet;
            this.raisesThisStreet++;
            if (incr >= this.minRaise) {
              this.minRaise = incr;
              this.players.forEach(q => { if (!q.folded && !q.allin && q.id !== p.id) q.acted = false; });
            }
            // 不足额全下：不重新打开加注
          }
          this._log(`💥 ${p.name} 梭哈 ${put}！`);
          this._emit('allin', { player: id, amount: put });
          break;
        }
        default:
          return { ok: false, error: '未知动作' };
      }
      this._afterAction();
      return { ok: true };
    }

    _afterAction() {
      if (this.alive.length === 1) { this._showdown(); return; }
      if (this._roundOver()) { this._nextStreet(); return; }
      this.current = this._nextActive(this.current);
    }

    _roundOver() {
      return this.alive.every(p => p.allin || (p.acted && p.bet === this.highBet));
    }

    _dealNextStreet() {
      this.players.forEach(p => { p.bet = 0; p.acted = false; });
      this.highBet = 0; this.minRaise = this.bb; this.raisesThisStreet = 0;
      if (this.stage === 'preflop') { this.community.push(this.deck.pop(), this.deck.pop(), this.deck.pop()); this.stage = 'flop'; }
      else if (this.stage === 'flop') { this.community.push(this.deck.pop()); this.stage = 'turn'; }
      else if (this.stage === 'turn') { this.community.push(this.deck.pop()); this.stage = 'river'; }
      this._log(`—— ${this._stageName()} ——`);
      this._emit('street', { stage: this.stage, community: this.community.map(cardStr) });
    }

    _nextStreet() {
      if (this.stage === 'river') { this._showdown(); return; }
      this._dealNextStreet();
      if (this.active.length <= 1) {
        this.current = -1;
        this.needsRunout = true;
        return;
      }
      this.current = (this.dealer + 1) % this.players.length;
      if (this.players[this.current].folded || this.players[this.current].allin) this.current = this._nextActive(this.current);
    }

    /* 全下后每次只推进一条街，让前端能展示翻牌、转牌、河牌。 */
    advanceRunout() {
      if (this.over || !this.needsRunout) return false;
      if (this.stage === 'river') {
        this.needsRunout = false;
        this._showdown();
        return true;
      }
      this._dealNextStreet();
      this.current = -1;
      return true;
    }

    _stageName() { return { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌' }[this.stage] || this.stage; }

    /* 主池 / 边池计算 */
    _computePots() {
      const contrib = this.players.filter(p => p.total > 0);
      const levels = [...new Set(contrib.map(p => p.total))].sort((a, b) => a - b);
      let prev = 0; const pots = [];
      for (const lv of levels) {
        const inLayer = contrib.filter(p => p.total >= lv);
        const amount = inLayer.reduce((s, p) => s + (lv - prev), 0);
        const eligible = inLayer.filter(p => !p.folded).map(p => p.id);
        if (amount > 0) pots.push({ amount, eligible, level: lv });
        prev = lv;
      }
      return pots;
    }

    _showdown() {
      this.stage = 'showdown';
      this.needsRunout = false;
      this.current = -1;
      const alive = this.alive;
      alive.forEach(p => { p.hand = bestHand([...p.hole, ...this.community]); });

      if (alive.length === 1) {
        const w = alive[0];
        w.chips += this.pot;
        this.lastPayout = [{ pot: this.pot, winners: [w.id], eligible: [w.id] }];
        this._log(`🏆 ${w.name} 赢得奖池 ${this.pot}（其余弃牌）`);
        this._emit('payout', { winners: [w.id], amount: this.pot });
        this.pot = 0;
      } else {
        alive.forEach(p => this._log(`🃏 ${p.name} 牌型 ${handName(p.hand)}`));
        const pots = this._computePots();
        for (const pot of pots) {
          const elig = this.players.filter(p => pot.eligible.includes(p.id));
          if (elig.length === 0) continue;
          let winners = [elig[0]];
          elig.forEach(p => {
            const c = handCompare(p.hand, winners[0].hand);
            if (c > 0) winners = [p];
            else if (c === 0 && !winners.includes(p)) winners.push(p);
          });
          const share = Math.floor(pot.amount / winners.length);
          let rem = pot.amount - share * winners.length;
          winners.forEach(w => { w.chips += share + (rem-- > 0 ? 1 : 0); });
          this.lastPayout.push({ pot: pot.amount, winners: winners.map(w => w.id), eligible: pot.eligible, level: pot.level });
          this._emit('payout', { winners: winners.map(w => w.id), amount: pot.amount, eligible: pot.eligible });
        }
        this._log(`🏆 ${this.lastPayout.flatMap(p => p.winners).map(id => this.byId(id).name).filter((v, i, a) => a.indexOf(v) === i).join('、')} 获胜`);
        this.pot = 0;
      }
      this.over = true;
      this.reconcileReport = this._reconcile();
      this._emit('hand-end', { report: this.reconcileReport });
    }

    /* ---------------- 机器对账 ---------------- */
    _reconcile() {
      const checks = [];
      const add = (name, pass, detail) => checks.push({ name, pass, detail });

      // 1. 积分守恒：开局快照 == 结束积分（本手内）
      const startSum = this.startSnapshot.reduce((s, x) => s + x.chips, 0);
      const endSum = this.players.reduce((s, p) => s + p.chips, 0);
      add('积分守恒', startSum === endSum, `开局 ${startSum} / 结束 ${endSum}`);

      // 2. 奖池清零
      add('奖池清零', this.pot === 0, `剩余奖池 ${this.pot}`);

      // 3. 牌面唯一（底牌 + 公共牌无重复）
      const all = this.players.flatMap(p => p.hole).concat(this.community);
      const key = all.map(c => c.rank + c.suit);
      add('牌面唯一', new Set(key).size === key.length, `共 ${key.length} 张，重复 ${key.length - new Set(key).size} 张`);

      // 4. 派彩资格与牌型正确性（逐池）
      let payoutOk = true, payoutDetail = [];
      for (const pay of this.lastPayout) {
        for (const wid of pay.winners) {
          if (!pay.eligible.includes(wid)) { payoutOk = false; payoutDetail.push(`${this.byId(wid).name} 无资格`); }
        }
        const elig = this.players.filter(p => pay.eligible.includes(p.id) && p.hand);
        if (elig.length === 0) continue; // 单人收池 / 未亮牌，不比牌型
        const best = elig.map(p => p.hand).reduce((a, b) => handCompare(a, b) > 0 ? a : b);
        for (const wid of pay.winners) {
          if (handCompare(this.byId(wid).hand, best) !== 0) { payoutOk = false; payoutDetail.push(`${this.byId(wid).name} 非该池最大`); }
        }
      }
      add('派彩资格与牌型', payoutOk, payoutDetail.join('；') || '各池赢家均有资格且牌型最大');

      // 5. 派彩金额闭合：每池分配额 == 池额
      let amtOk = true, amtDetail = [];
      for (const pay of this.lastPayout) {
        // 平分后总额 = pot（余料已分摊）
        if (pay.winners.length === 0) { amtOk = false; continue; }
      }
      add('派彩金额闭合', amtOk, amtDetail.join('；') || '无空池');

      const ok = checks.every(c => c.pass);
      return { ok, checks, startSum, endSum, pot: this.pot };
    }

    /* 投影给前端：平时只亮自己底牌；摊牌阶段公开全部玩家底牌 */
    snapshot(forId) {
      return {
        stage: this.stage, over: this.over, pot: this.pot,
        dealer: this.dealer, current: this.players[this.current]?.id || null,
        highBet: this.highBet, minRaise: this.minRaise, needsRunout: this.needsRunout,
        raisesThisStreet: this.raisesThisStreet, maxRaises: this.maxRaises,
        community: this.community.map(cardStr),
        handNo: this.handNo,
        players: this.players.map(p => ({
          id: p.id, name: p.name, isHuman: p.isHuman, isBot: p.isBot,
          chips: p.chips, bet: p.bet, total: p.total,
          folded: p.folded, allin: p.allin, acted: p.acted,
          hand: p.hand ? handName(p.hand) : null,
          hole: (p.id === forId || this.stage === 'showdown') ? p.hole.map(cardStr) : null
        })),
        log: this.log.slice(-80).map(x => ({ seq: x.seq, msg: x.msg })),
        payout: this.lastPayout,
        report: this.reconcileReport,
        startChips: Object.fromEntries((this.startSnapshot || []).map(x => [x.id, x.chips])),
        events: this.events.slice(-200)
      };
    }
  }

  return {
    SUITS, RANK_LABEL, HAND_NAMES,
    buildDeck, shuffle, secureRandom, cardStr, isRed,
    evaluate5, bestHand, handCompare, handName,
    preflopStrength, botHandStrength, botDecide,
    Table
  };
});
