const Core = window.GameCore;
function getPos(){
  const land = innerWidth > innerHeight;
  if(land) return [{x:50,y:70},{x:9,y:50},{x:50,y:18},{x:91,y:50}];
  if(innerWidth<=600) return [{x:50,y:71},{x:13,y:50},{x:50,y:13},{x:87,y:50}];
  return [{x:50,y:62},{x:10,y:55},{x:50,y:14},{x:90,y:55}];
}
let mode = null;
let table = null;
let ws = null, myPid = null, roomCode = null, lastState = null;
const $ = id => document.getElementById(id);

/* =====================================================================
 * 数字转中文（语音播报用）
 * ===================================================================== */
function cnNum(n){
  const d=['零','一','二','三','四','五','六','七','八','九'];
  if(n<10) return d[n];
  if(n<20) return '十'+(n%10?cnNum(n%10):'');
  if(n<100){ const t=Math.floor(n/10),o=n%10; return cnNum(t)+'十'+(o?cnNum(o):''); }
  if(n<1000){ const h=Math.floor(n/100),r=n%100; return cnNum(h)+'百'+(r?(r<10?'零':'')+cnNum(r):''); }
  return String(n);
}

/* =====================================================================
 * 音频系统：WebAudio 合成音效 + 双声部循环 BGM + 中文语音播报
 * ===================================================================== */
const AudioSys = {
  ctx:null, master:null, sfxGain:null, bgmGain:null,
  bgmTimer:null, bgmTrack:0,
  lead:{step:0,next:0}, bass:{step:0,next:0},
  sfxOn:true, voiceOn:true,
  voiceQueue:[], speaking:false,

  ensure(){
    if(this.ctx){ if(this.ctx.state==='suspended') this.ctx.resume(); return; }
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) return;
    this.ctx=new AC();
    this.master=this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfxGain=this.ctx.createGain(); this.sfxGain.gain.value=1.5; this.sfxGain.connect(this.master);
    this.bgmGain=this.ctx.createGain(); this.bgmGain.gain.value=0.7; this.bgmGain.connect(this.master);
    this.volume();
  },
  volume(){ const v=($('volume').value||70)/100; if(this.master) this.master.gain.value=v; },
  midi(m){ return 440*Math.pow(2,(m-69)/12); },

  tone(freq,dur,{type='sine',vol=.2,when=0,slide=null,dest=null}={}){
    if(!this.ctx||this.ctx.state!=='running') return;
    const t=this.ctx.currentTime+when;
    const o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,t);
    if(slide) o.frequency.exponentialRampToValueAtTime(slide,t+dur);
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(vol,t+.015);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g); g.connect(dest||this.sfxGain);
    o.start(t); o.stop(t+dur+.05);
    o.onended=()=>{ try{o.disconnect();g.disconnect();}catch(e){} };
  },

  sfx(name){
    if(!this.ctx||!this.sfxOn) return;
    switch(name){
      case 'deal':  this.tone(1200,.06,{type:'triangle',vol:.14}); break;
      case 'check': this.tone(760,.07,{type:'sine',vol:.2}); break;
      case 'call':  this.tone(620,.08,{type:'square',vol:.16}); this.tone(840,.09,{type:'square',vol:.16,when:.08}); break;
      case 'raise': this.tone(500,.18,{type:'sawtooth',vol:.18,slide:920}); break;
      case 'fold':  this.tone(420,.22,{type:'sawtooth',vol:.14,slide:150}); break;
      case 'allin': this.tone(440,.2,{type:'sawtooth',vol:.18,slide:880}); this.tone(660,.24,{type:'square',vol:.16,when:.1}); break;
      case 'flip':  this.tone(980,.06,{type:'triangle',vol:.14}); break;
      case 'flop':  [72,76,79].forEach((m,i)=>this.tone(this.midi(m),.12,{type:'triangle',vol:.16,when:i*.07})); break;
      case 'street':this.tone(880,.1,{type:'triangle',vol:.15}); this.tone(1100,.12,{type:'triangle',vol:.14,when:.08}); break;
      case 'win':   [72,76,79,84].forEach((m,i)=>this.tone(this.midi(m),.2,{type:'triangle',vol:.2,when:i*.11})); break;
      case 'bigwin':[72,76,79,84,88,91].forEach((m,i)=>this.tone(this.midi(m),.22,{type:'triangle',vol:.2,when:i*.1})); break;
    }
  },

  /* 曲目：lead 主旋律 + bass 低音铺底，[midi, 拍数]，0 休止；五声音阶欢快风 */
  tracks:{
    1:{ bpm:128, leadWave:'triangle', bassWave:'sine',
        lead:[[76,.5],[79,.5],[81,.5],[79,.5],[76,.5],[74,.5],[72,.5],[74,.5],[76,.5],[79,.5],[81,.5],[84,.5],[81,.5],[79,.5],[76,.5],[74,.5]],
        bass:[[48,2],[55,2],[57,2],[53,2]] },
    2:{ bpm:120, leadWave:'square', bassWave:'triangle',
        lead:[[72,.5],[72,.5],[76,.5],[79,.5],[76,.5],[72,.5],[74,.5],[74,.5],[77,.5],[74,.5],[72,.5],[72,.5],[76,.5],[79,.5],[81,.5],[79,.5]],
        bass:[[48,1],[48,1],[55,1],[55,1],[53,1],[53,1],[55,1],[55,1]] },
    3:{ bpm:112, leadWave:'triangle', bassWave:'sine',
        lead:[[69,.5],[72,.5],[76,.5],[72,.5],[74,.5],[77,.5],[74,.5],[72,.5],[69,.5],[72,.5],[76,.5],[79,.5],[77,.5],[76,.5],[74,.5],[72,.5]],
        bass:[[45,2],[52,2],[48,2],[50,2]] },
    4:{ bpm:136, leadWave:'sawtooth', bassWave:'square',
        lead:[[72,.5],[76,.5],[79,.5],[84,.5],[79,.5],[76,.5],[74,.5],[76,.5],[72,.5],[76,.5],[79,.5],[86,.5],[84,.5],[79,.5],[76,.5],[74,.5]],
        bass:[[48,1],[55,1],[48,1],[55,1],[57,1],[53,1],[57,1],[53,1]] },
    5:{ bpm:108, leadWave:'sine', bassWave:'sine',
        lead:[[64,1],[67,1],[72,1],[67,1],[69,1],[72,1],[69,1],[67,1],[64,1],[67,1],[71,1],[72,1],[69,1],[67,1],[64,1],[62,1]],
        bass:[[48,2],[48,2],[45,2],[43,2]] },
    6:{ bpm:124, leadWave:'triangle', bassWave:'triangle',
        lead:[[72,.5],[76,.5],[79,.5],[76,.5],[81,.5],[79,.5],[76,.5],[72,.5],[74,.5],[77,.5],[81,.5],[77,.5],[76,.5],[74,.5],[72,.5],[74,.5]],
        bass:[[48,1],[55,1],[52,1],[55,1],[50,1],[57,1],[48,1],[55,1]] },
    7:{ bpm:100, leadWave:'sine', bassWave:'sine',
        lead:[[67,1],[72,1],[76,1],[72,1],[74,1],[77,1],[74,1],[72,1],[67,1],[72,1],[79,1],[76,1],[74,1],[72,1],[69,1],[67,1]],
        bass:[[43,2],[50,2],[45,2],[52,2]] },
    8:{ bpm:130, leadWave:'square', bassWave:'square',
        lead:[[76,.5],[76,.5],[79,.5],[76,.5],[81,.5],[79,.5],[76,.5],[79,.5],[84,.5],[81,.5],[79,.5],[76,.5],[74,.5],[76,.5],[74,.5],[72,.5]],
        bass:[[36,1],[43,1],[36,1],[43,1],[41,1],[48,1],[38,1],[45,1]] }
  },

  startBGM(track){
    this.bgmTrack=track; this.stopBGM();
    if(!track||!this.ctx) return;
    const t=this.tracks[track]; if(!t) return;
    const begin=()=>{
      this.lead={step:0,next:this.ctx.currentTime+.1};
      this.bass={step:0,next:this.ctx.currentTime+.1};
      const beat=60/t.bpm;
      this.bgmTimer=setInterval(()=>{
        if(!this.ctx||this.ctx.state!=='running') return;
        const ahead=this.ctx.currentTime+.3;
        while(this.lead.next<ahead){
          const [m,b]=t.lead[this.lead.step%t.lead.length];
          if(m>0) this.tone(this.midi(m),b*beat*.9,{type:t.leadWave,vol:.09,when:this.lead.next-this.ctx.currentTime,dest:this.bgmGain});
          this.lead.next+=b*beat; this.lead.step++;
        }
        while(this.bass.next<ahead){
          const [m,b]=t.bass[this.bass.step%t.bass.length];
          if(m>0) this.tone(this.midi(m),b*beat*.95,{type:t.bassWave,vol:.05,when:this.bass.next-this.ctx.currentTime,dest:this.bgmGain});
          this.bass.next+=b*beat; this.bass.step++;
        }
      },120);
    };
    if(this.ctx.state==='running') begin();
    else this.ctx.addEventListener('resume',()=>{ if(this.bgmTrack===track) begin(); },{once:true});
  },
  stopBGM(){ if(this.bgmTimer){clearInterval(this.bgmTimer);this.bgmTimer=null;} },

  /* 中文语音播报：队列依次播放，避免互相打断造成错乱 */
  speak(text){
    if(!this.voiceOn||!('speechSynthesis' in window)||!text) return;
    this.voiceQueue.push(text); this.pumpVoice();
  },
  pumpVoice(){
    if(this.speaking) return;
    if(!this.voiceOn||!this.voiceQueue.length){ this.voiceQueue.length=0; return; }
    const text=this.voiceQueue.shift();
    const u=new SpeechSynthesisUtterance(text);
    u.lang='zh-CN'; u.rate=1.05; u.pitch=1; u.volume=1;
    this.speaking=true;
    const done=()=>{ this.speaking=false; this.pumpVoice(); };
    u.onend=done; u.onerror=done;
    try{ speechSynthesis.speak(u); }catch(e){ this.speaking=false; }
  },
  stopVoice(){
    if('speechSynthesis' in window){ try{ speechSynthesis.cancel(); }catch(e){} }
    this.voiceQueue.length=0; this.speaking=false;
  }
};

/* 解析一行日志 → 播报 + 音效 */
function announceLine(line){
  let m;
  if(m=line.match(/跟注\s*(\d+)/)){ AudioSys.speak('跟注'+cnNum(+m[1])); AudioSys.sfx('call'); }
  else if(m=line.match(/加注到?\s*(\d+)/)){ AudioSys.speak('加注'+cnNum(+m[1])); AudioSys.sfx('raise'); }
  else if(/弃牌/.test(line)){ AudioSys.speak('弃牌'); AudioSys.sfx('fold'); }
  else if(/过牌/.test(line)){ AudioSys.speak('过牌'); AudioSys.sfx('check'); }
  else if(m=line.match(/全下\s*(\d+)/)){ AudioSys.speak('全下'+cnNum(+m[1])); AudioSys.sfx('allin'); }
  else if(/亮出/.test(line)){ AudioSys.sfx('flip'); }
  else if(/——\s*翻牌\s*——/.test(line)){ AudioSys.sfx('flop'); }
  else if(/转牌|河牌/.test(line)){ AudioSys.sfx('street'); }
  else if(/赢得|获胜/.test(line)){ AudioSys.speak('获胜'); AudioSys.sfx('win'); }
}

/* 解析一行日志 → 座位气泡 {idx,text,cls}；找不到返回 null */
function bubbleForLine(st, line){
  let name=null, rest='';
  for(const p of st.players){ if(line.includes(p.name)){ name=p.name; rest=line.split(p.name)[1]||''; break; } }
  if(!name) return null;
  let m, text='', cls='b-check';
  if(m=rest.match(/弃牌/)){ text='弃牌'; cls='b-fold'; }
  else if(m=rest.match(/过牌/)){ text='过牌'; cls='b-check'; }
  else if(m=rest.match(/跟注\s*(\d+)/)){ text='跟注 '+m[1]; cls='b-call'; }
  else if(m=rest.match(/加注到?\s*(\d+)/)){ text='加注 '+m[1]; cls='b-raise'; }
  else if(m=rest.match(/全下\s*(\d+)/)){ text='全下 '+m[1]; cls='b-allin'; }
  else if(m=rest.match(/下小盲\s*(\d+)/)){ text='小盲 '+m[1]; cls='b-blind'; }
  else if(m=rest.match(/下大盲\s*(\d+)/)){ text='大盲 '+m[1]; cls='b-blind'; }
  else if(/获胜|赢得/.test(rest)){ text='获胜'; cls='b-win'; }
  else return null;
  const idx=st.players.findIndex(p=>p.name===name);
  return { idx, text, cls };
}

/* 在指定座位上挂气泡，停留后自动移除；同座位先清旧气泡避免叠加 */
function showBubble(st, line){
  const b=bubbleForLine(st, line);
  if(!b||b.idx<0) return;
  const seat=document.querySelector(`.seat[data-idx="${b.idx}"]`);
  if(!seat) return;
  seat.querySelectorAll('.action-bubble').forEach(e=>e.remove());
  const el=document.createElement('div');
  el.className='action-bubble '+b.cls;
  el.textContent=b.text;
  seat.appendChild(el);
  const hold=(b.cls==='b-blind'||b.cls==='b-win')?2800:1700;
  setTimeout(()=>el.remove(), hold);
}

/* ---------------- 联机 ---------------- */
function wsUrl(){ const p=location.protocol==='https:'?'wss':'ws'; return `${p}://${location.host}/`; }
function setConnMsg(text, ok){ const el=$('connMsg'); el.textContent=text||''; el.className='conn-msg'+(ok?' ok':''); }
let pendingMsg=null;
function connect(pending){
  pendingMsg=pending||null;
  if(location.protocol==='file:'||!location.host){
    setConnMsg('当前是本地文件，无法联机。请解压源码包运行 npm install && npm start，再用浏览器打开 http://localhost:3000');
    return;
  }
  setConnMsg('正在连接联机服务…', true);
  try{ ws=new WebSocket(wsUrl()); }
  catch(e){ setConnMsg('连接失败：'+e.message); return; }
  ws.onopen=()=>{ setConnMsg('已连接，正在进入房间…', true); if(pendingMsg){ send(pendingMsg); pendingMsg=null; } };
  ws.onmessage=e=>{
    const msg=JSON.parse(e.data);
    if(msg.type==='room'){ myPid=msg.pid; roomCode=msg.code; onJoined(); }
    else if(msg.type==='state'){ lastState=msg.state; render(); }
    else if(msg.type==='error'){ setConnMsg(msg.error); $('message').textContent=msg.error; }
  };
  ws.onerror=()=>setConnMsg('无法连接联机服务：请确认本地服务已启动（node server.js）后刷新页面');
  ws.onclose=()=>{ if(mode!=='online') setConnMsg('连接已断开，刷新可重连'); };
}
function send(msg){ if(ws&&ws.readyState===1) ws.send(JSON.stringify(msg)); }
function onJoined(){
  $('menu').style.display='none';
  $('tableWrap').style.display='grid';
  $('roomCodeSide').style.display=roomCode?'block':'none';
  $('roomCodeSide').textContent=roomCode?`房间码：${roomCode}`:'';
  $('inviteRow').style.display='flex';
  $('inviteLink').value=location.href+(location.href.includes('?')?'&':'?')+'room='+roomCode;
  $('btnAddBot').style.display='block';
  // 进房后自动补位并开局
  setTimeout(()=>send({type:'start'}), 400);
}

/* ---------------- 单机 ---------------- */
function startOffline(){
  mode='offline';
  table=new Core.Table({maxSeats:4});
  const nick=$('nick').value.trim()||'玩家';
  table.addPlayer({id:'me',name:nick,isHuman:true});
  table.addPlayer({id:'b1',name:'AI·稳健',isBot:true,personality:0});
  table.addPlayer({id:'b2',name:'AI·凶猛',isBot:true,personality:2});
  table.addPlayer({id:'b3',name:'AI·机灵',isBot:true,personality:1});
  $('menu').style.display='none';
  $('tableWrap').style.display='grid';
  startHandOffline();
}
function startHandOffline(){
  AudioSys.ensure();
  table.startHand();
  lastLogLen=0;
  lastState=table.snapshot('me');
  render();
  scheduleOfflineBot();
}
function handStrength(t,p){
  if(t.community.length===0){
    const [a,b]=p.hole.map(c=>c.rank).sort((x,y)=>y-x);
    let s;
    if(a===b) s=a>=11?.88:a>=8?.74:.58;
    else{ s=.3+((a-2)/12)*.35; if(a===14)s+=.08;
      if(p.hole[0].suit===p.hole[1].suit)s+=.1;
      if(Math.abs(a-b)===1)s+=.06; else if(Math.abs(a-b)<=2)s+=.03; }
    return Math.min(1,Math.max(0,s));
  }
  const h=Core.bestHand([...p.hole,...t.community]);
  const base=[.18,.34,.46,.56,.66,.76,.86,.95,1][h[0]];
  let draw=0; const all=t.community.concat(p.hole); const sc={};
  all.forEach(c=>sc[c.suit]=(sc[c.suit]||0)+1);
  if(Object.values(sc).some(n=>n>=4))draw+=.1;
  return Math.min(1,base+draw+Math.random()*.08);
}
function botDecide(t,p){
  const s=handStrength(t,p);const call=t.highBet-p.bet;
  const style=p.personality==null?1:p.personality;const r=Math.random();
  const bluff=style===2?.14:style===0?.05:.09;
  const raiseTh=style===2?.58:.66;const callTh=style===0?.46:.40;
  if(call===0){ if(s>raiseTh||(r<bluff&&s>.35))return{type:'raise',to:t.highBet+t.minRaise}; return{type:'check'}; }
  if(s>.74||(style===2&&s>.6&&r<.5))return{type:'raise',to:t.highBet+t.minRaise};
  if(s>callTh||r<bluff*.5)return{type:'call'};
  return{type:'fold'};
}
function scheduleOfflineBot(){
  if(table.over) return;
  const p=table.players[table.current];
  if(p&&p.isBot){
    setTimeout(()=>{
      const la=table.legalActions(p);const cmd=botDecide(table,p);
      const r=table.act(p.id,cmd);
      if(!r.ok){if(la.call)table.act(p.id,{type:'call'});else table.act(p.id,{type:'fold'});}
      lastState=table.snapshot('me');render();scheduleOfflineBot();
    },1300);
  }
}

/* ---------------- 动作 ---------------- */
function doAction(action){
  AudioSys.ensure();
  if(mode==='online'){ send({type:'action',action}); return; }
  const r=table.act('me',action);
  if(r.ok){
    lastState=table.snapshot('me'); render(); scheduleOfflineBot();
  }
}

/* ---------------- 渲染 ---------------- */
function strCardHTML(s,down){
  if(down) return '<div class="card back"></div>';
  const m=s.match(/([0-9]+|J|Q|K|A)([♠♥♦♣])/);
  const red=m[2]==='♥'||m[2]==='♦';
  return `<div class="card ${red?'red':''}"><span>${m[1]}</span><span class="s">${m[2]}</span></div>`;
}

let lastLogLen=0;
function render(){
  const st=lastState; if(!st) return;
  document.querySelectorAll('.seat').forEach(e=>e.remove());
  const tableEl=$('table');

  const newLines=st.log.slice(lastLogLen);
  newLines.forEach(announceLine);
  lastLogLen=st.log.length;

  const winnerIds=new Set();
  if(st.over&&st.payout) st.payout.forEach(p=>p.winners.forEach(w=>winnerIds.add(w)));

  // 人类固定底部第一视角，其余玩家按顺序环绕左/顶/右
  const meId=mode==='offline'?'me':myPid;
  const meIdx=Math.max(0,st.players.findIndex(p=>p.id===meId));
  const order=st.players.map((p,i)=>i).sort((a,b)=>{
    if(a===meIdx)return -1; if(b===meIdx)return 1; return a-b;
  });
  order.forEach((i,pos)=>{
    const p=st.players[i];
    const position=getPos()[pos%4];
    const seat=document.createElement('div');
    seat.className='seat'+(p.id===st.current&&!st.over?' active':'')+(p.folded?' folded':'')+(p.allin?' allin':'')+(winnerIds.has(p.id)?' winner':'');
    seat.dataset.idx=i;
    seat.style.left=position.x+'%';seat.style.top=position.y+'%';
    const tags=[];
    if(i===st.dealer)tags.push({label:'庄家',cls:'dealer'});
    if(i===(st.dealer+1)%st.players.length)tags.push({label:'小盲',cls:'sb'});
    if(i===(st.dealer+2)%st.players.length)tags.push({label:'大盲',cls:'bb'});
    if(p.allin)tags.push({label:'全下',cls:'allin'});
    if(p.isBot)tags.push({label:'AI',cls:'bot'});
    let holeHTML;
    if(p.folded) holeHTML='<div class="card back"></div><div class="card back"></div>';
    else if(p.hole) holeHTML=p.hole.map(c=>strCardHTML(c,false)).join('');
    else holeHTML='<div class="card back"></div><div class="card back"></div>';
    const foldBadge=p.folded?'<div class="fold-badge">已弃牌</div>':'';
    seat.innerHTML=`
      <div class="name">${p.name}</div>
      <div class="chips">积分 ${p.chips}</div>
      <div class="cards">${holeHTML}</div>
      <div class="bet">${p.bet>0?'下注 '+p.bet:''}</div>
      <div class="handinfo">${p.hand||''}</div>
      <div>${tags.map(t=>`<span class="tag ${t.cls}">${t.label}</span>`).join(' ')}</div>
      ${foldBadge}`;
    tableEl.appendChild(seat);
  });

  newLines.forEach(line=>showBubble(st, line));

  $('community').innerHTML=st.community.length?st.community.map(c=>strCardHTML(c,false)).join(''):'<div style="color:#ffffff55">等待发牌</div>';
  $('pot').textContent='奖池 '+st.pot;
  const stageName={preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌',showdown:'摊牌',idle:'准备开始'}[st.stage]||st.stage;
  $('stage').textContent=st.over?'本局结束':('阶段：'+stageName);
  /* 开局身份提示，翻牌前常驻中央，便于看清庄家/盲注 */
  if(!st.over&&st.stage==='preflop'&&st.players.length>=2){
    const n=st.players.length;
    const dp=st.players[st.dealer], sb=st.players[(st.dealer+1)%n], bb=st.players[(st.dealer+2)%n];
    $('message').textContent=`庄家 ${dp.name}　小盲 ${sb.name}　大盲 ${bb.name}`;
  } else { $('message').textContent=''; }
  $('log').innerHTML=st.log.slice(-80).map(l=>`<div>${l}</div>`).join('');
  $('log').scrollTop=$('log').scrollHeight;

  renderRecon(st.report);
  renderControls(st);
  renderResult(st);
}

let resultDismissed=false;
/* 结算浮层：胜负 + 各家盈亏与剩余积分；可关闭回看桌面牌 */
function renderResult(st){
  const overlay=$('resultOverlay');
  if(!st.over){ resultDismissed=false; overlay.style.display='none'; overlay.innerHTML=''; return; }
  const meId=mode==='offline'?'me':myPid;
  const start=st.startChips||{};
  const rows=st.players.map(p=>{
    const s0=start[p.id]!=null?start[p.id]:p.chips;
    return { id:p.id, name:p.name, delta:p.chips-s0, chips:p.chips, isHuman:p.id===meId };
  });
  const me=rows.find(r=>r.id===meId)||rows[0];
  const cls=me.delta>0?'win':me.delta<0?'lose':'draw';
  const title=me.delta>0?'胜利！':me.delta<0?'失败':'平局';
  const dCls=me.delta>0?'pos':me.delta<0?'neg':'';
  const dText=(me.delta>0?'赢 +':'输 ')+Math.abs(me.delta);
  const rowHTML=rows.map(r=>{
    const rc=r.delta>0?'pos':r.delta<0?'neg':'';
    const sign=r.delta>0?'+':'';
    return `<div class="result-row">
      <span>${r.name}${r.isHuman?'（你）':''}</span>
      <span class="r-pos ${rc}">${sign}${r.delta}</span>
      <span>剩余 ${r.chips}</span>
    </div>`;
  }).join('');
  if(resultDismissed){ overlay.style.display='none'; return; }
  overlay.style.display='flex';
  overlay.innerHTML=`
    <div class="result-panel">
      <div class="result-title ${cls}">${title}</div>
      <div class="result-delta ${dCls}">本局${dText} 积分</div>
      <div class="result-rows">${rowHTML}</div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn-continue" id="btnContinue">继续游戏</button>
        <button class="secondary" id="btnViewBoard">查看牌局</button>
      </div>
    </div>`;
  $('btnContinue').onclick=()=>{ $('btnNewHand').click(); };
  $('btnViewBoard').onclick=()=>{ resultDismissed=true; overlay.style.display='none'; };
}

/* 对账：日志区底部低调一行 */
function renderRecon(report){
  const box=$('reconLine');
  if(!report){ box.innerHTML=''; return; }
  const head=report.ok?'<span class="ok">✓ 对账通过</span>':'<span class="bad">✗ 对账异常</span>';
  const detail=report.checks.map(c=>`${c.pass?'✓':'✗'}${c.name}`).join('　');
  box.innerHTML=`${head}<div class="check">${detail}</div>`;
}

function renderControls(st){
  const box=$('controls'); box.innerHTML='';
  if(st.over){
    const nb=document.createElement('button');nb.className='btn-continue';nb.textContent='继续游戏';
    nb.onclick=()=>$('btnNewHand').click();box.appendChild(nb);return;
  }
  const me=st.players.find(p=>p.id===myPid||(mode==='offline'&&p.id==='me'));
  if(!me||me.folded||me.allin||st.current!==me.id) return;

  const callAmt=Math.max(0,st.highBet-me.bet);
  const minTo=st.highBet+(st.minRaise||20);
  const maxTo=me.bet+me.chips;

  const fold=document.createElement('button');fold.className='btn-fold';fold.textContent='弃牌';
  fold.onclick=()=>doAction({type:'fold'});box.appendChild(fold);

  if(callAmt===0){
    const ck=document.createElement('button');ck.className='btn-call';ck.textContent='过牌';
    ck.onclick=()=>doAction({type:'check'});box.appendChild(ck);
  }else{
    const cl=document.createElement('button');cl.className='btn-call';cl.textContent=`跟注 ${Math.min(callAmt,me.chips)}`;
    cl.onclick=()=>doAction({type:'call'});box.appendChild(cl);
  }
  if(maxTo>=minTo){
    const row=document.createElement('div');row.className='raise-row';
    const num=document.createElement('input');num.type='number';num.value=minTo;num.min=minTo;num.max=maxTo;
    const ra=document.createElement('button');ra.className='btn-raise';ra.textContent='加注';
    ra.onclick=()=>{let to=parseInt(num.value)||minTo;to=Math.max(minTo,Math.min(maxTo,to));doAction({type:'raise',to});};
    row.appendChild(num);row.appendChild(ra);box.appendChild(row);
  }
  const ai=document.createElement('button');ai.className='btn-allin';ai.textContent='全下';
  ai.onclick=()=>doAction({type:'allin'});box.appendChild(ai);
}

/* ---------------- 事件绑定 ---------------- */
function audioWake(){ AudioSys.ensure(); AudioSys.startBGM(parseInt($('bgmSelect').value)); }
$('btnOffline').onclick=()=>{ audioWake(); startOffline(); };
$('btnCreate').onclick=()=>{ mode='online'; audioWake(); connect({type:'create',name:$('nick').value.trim()||'玩家'}); };
$('btnJoin').onclick=()=>{ mode='online'; audioWake(); connect({type:'join',code:$('roomCode').value.trim(),name:$('nick').value.trim()||'玩家'}); };
$('btnNewHand').onclick=()=>{ lastLogLen=0; if(mode==='online') send({type:'start'}); else startHandOffline(); };
$('btnAddBot').onclick=()=>{ if(mode==='online') send({type:'add-bot'}); };
$('btnCopy').onclick=()=>{ $('inviteLink').select(); navigator.clipboard&&navigator.clipboard.writeText($('inviteLink').value); };
$('btnExport').onclick=()=>{
  const ev=mode==='offline'?table.events:(lastState&&lastState.events)||[];
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),events:ev},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='record-data.json';a.click();
};

$('bgmSelect').onchange=e=>{ AudioSys.ensure(); AudioSys.startBGM(parseInt(e.target.value)); };
$('voiceToggle').onchange=e=>{ AudioSys.voiceOn=e.target.checked; if(!AudioSys.voiceOn) AudioSys.stopVoice(); };
$('sfxToggle').onchange=e=>{ AudioSys.sfxOn=e.target.checked; };
$('volume').oninput=()=>{ AudioSys.ensure(); AudioSys.volume(); };

/* 旋转 / 缩放窗口后按新方向重排座位 */
let resizeTimer=null;
window.addEventListener('resize',()=>{ clearTimeout(resizeTimer); resizeTimer=setTimeout(()=>{ if(lastState) render(); },120); });
window.addEventListener('orientationchange',()=>setTimeout(()=>{ if(lastState) render(); },220));

(function(){ const q=new URLSearchParams(location.search); const r=q.get('room'); if(r){ $('roomCode').value=r; } })();
