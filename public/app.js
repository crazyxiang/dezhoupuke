const Core = window.GameCore;
function getPos(n){
  const land = innerWidth > innerHeight;
  n = n || 4;
  if(land){
    if(n <= 2) return [{x:50,y:69},{x:50,y:12}];
    if(n === 3) return [{x:50,y:69},{x:18,y:34},{x:82,y:34}];
    return [{x:50,y:70},{x:16,y:34},{x:50,y:11},{x:84,y:34}];
  }
  const short = innerHeight <= 640;
  if(short){
    if(n <= 2) return [{x:50,y:74},{x:50,y:12}];
    if(n === 3) return [{x:50,y:74},{x:18,y:68},{x:82,y:68}];
    return [{x:50,y:74},{x:18,y:68},{x:50,y:12},{x:82,y:68}];
  }
  if(n <= 2) return [{x:50,y:72},{x:50,y:18}];
  if(n === 3) return [{x:50,y:72},{x:18,y:59},{x:82,y:59}];
  return [{x:50,y:72},{x:18,y:62},{x:50,y:18},{x:82,y:62}];
}
let mode=null, table=null, ws=null, myPid=null, isOwner=false, roomCode=null, pendingJoinCode=null, lastState=null;
let reconnectTimer=null, reconnectTries=0, suppressAutoStart=false, heartbeatTimer=null, pongTimer=null, lastPongAt=0;
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cnNum(n){const d=['零','一','二','三','四','五','六','七','八','九'];if(n<10)return d[n];if(n<20)return'十'+(n%10?cnNum(n%10):'');if(n<100){const t=Math.floor(n/10),o=n%10;return cnNum(t)+'十'+(o?cnNum(o):'');}return String(n);}

const AudioSys={
  ctx:null,master:null,sfxGain:null,bgmGain:null,bgmTimer:null,bgmTrack:0,
  lead:{step:0,next:0},bass:{step:0,next:0},sfxOn:true,voiceOn:true,zhVoice:null,bgmEnabled:true,muted:false,
  voiceQueue:[],speaking:false,voiceUnlocked:false,voiceWarming:false,currentUtterance:null,
  ensure(){if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return;}const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;this.ctx=new AC();this.master=this.ctx.createGain();this.master.connect(this.ctx.destination);this.sfxGain=this.ctx.createGain();this.sfxGain.connect(this.master);this.bgmGain=this.ctx.createGain();this.bgmGain.gain.value=0.7;this.bgmGain.connect(this.master);this.volume();this.sfxVolume();try{this.ctx.resume();}catch(e){}},
  volume(){const raw=$('volume').value;const v=(raw===''||isNaN(+raw)?70:+raw)/100;if(this.master)this.master.gain.value=Math.max(0,Math.min(1,v));},
  sfxVolume(){if(!this.sfxGain)return;this.sfxGain.gain.value=0.5;}, /* 操作音效默认开启且固定音量，不再提供滑块 */
  midi(m){return 440*Math.pow(2,(m-69)/12);},
  tone(freq,dur,{type='sine',vol=0.5,when=0,slide=null,dest=null}={}){if(!this.ctx)return;const t=this.ctx.currentTime+when;const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);if(slide)o.frequency.exponentialRampToValueAtTime(slide,t+dur);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(dest||this.sfxGain);o.start(t);o.stop(t+dur+.05);o.onended=()=>{try{o.disconnect();g.disconnect();}catch(e){}};},
  pendingSfx:[],
  /* 浏览器策略：音频必须由用户手势解锁；解锁后补播排队中的音效 */
  unlock(){this.ensure();this.loadVoices();this.unlockVoice();if(!this.ctx)return;const flush=()=>{if(!this.ctx||this.ctx.state!=='running')return;const list=this.pendingSfx.splice(0);list.forEach(n=>this._play(n));};if(this.ctx.state==='running')flush();else this.ctx.resume().then(flush).catch(()=>{});},
  sfx(name){if(!this.ctx)this.ensure();if(!this.ctx)return;if(this.ctx.state==='running'){this._play(name);return;}if(this.pendingSfx.length<16)this.pendingSfx.push(name);this.ctx.resume().then(()=>{if(this.ctx.state!=='running')return;const list=this.pendingSfx.splice(0);list.forEach(n=>this._play(n));}).catch(()=>{});},
  _play(name){if(!this.ctx||this.ctx.state!=='running')return;switch(name){case'deal':this.tone(1200,.06,{type:'triangle',vol:.5});break;case'blind':this.tone(520,.06,{type:'triangle',vol:.45});this.tone(480,.06,{type:'triangle',vol:.4,when:.07});break;case'check':this.tone(760,.07,{type:'sine',vol:.55});break;case'call':this.tone(620,.08,{type:'square',vol:.45});this.tone(840,.09,{type:'square',vol:.45,when:.08});break;case'raise':this.tone(500,.18,{type:'sawtooth',vol:.5,slide:920});break;case'fold':this.tone(420,.22,{type:'sawtooth',vol:.4,slide:150});break;case'allin':this.tone(440,.2,{type:'sawtooth',vol:.5,slide:880});this.tone(660,.24,{type:'square',vol:.45,when:.1});break;case'flip':this.tone(980,.06,{type:'triangle',vol:.5});break;case'flop':[72,76,79].forEach((m,i)=>this.tone(this.midi(m),.12,{type:'triangle',vol:.5,when:i*.07}));break;case'street':this.tone(880,.1,{type:'triangle',vol:.5});this.tone(1100,.12,{type:'triangle',vol:.45,when:.08});break;case'win':[72,76,79,84].forEach((m,i)=>this.tone(this.midi(m),.2,{type:'triangle',vol:.6,when:i*.11}));break;case'emote':this.tone(880,.09,{type:'triangle',vol:.55});this.tone(1320,.13,{type:'triangle',vol:.45,when:.09});break;case'bigwin':[72,76,79,84,88,91].forEach((m,i)=>this.tone(this.midi(m),.24,{type:'triangle',vol:.72,when:i*.1}));this.tone(1046,.35,{type:'sine',vol:.35,when:.05});this.tone(1568,.3,{type:'sine',vol:.3,when:.18});break;case'coin':[84,88,91,96,100,103].forEach((m,i)=>this.tone(this.midi(m),.1,{type:'triangle',vol:.62,when:i*.05}));this.tone(1600,.18,{type:'sine',vol:.45,when:.04});this.tone(2100,.16,{type:'sine',vol:.38,when:.12});this.tone(2600,.14,{type:'sine',vol:.3,when:.2});this.tone(3200,.12,{type:'sine',vol:.22,when:.28});break;case'lose':[64,60,55].forEach((m,i)=>this.tone(this.midi(m),i===2?.34:.15,{type:'sine',vol:.42,when:i*.15}));this.tone(233,.28,{type:'triangle',vol:.18,when:.3});break;}},
  tracks:{1:{bpm:128,leadWave:'triangle',bassWave:'sine',lead:[[76,.5],[79,.5],[81,.5],[79,.5],[76,.5],[74,.5],[72,.5],[74,.5],[76,.5],[79,.5],[81,.5],[84,.5],[81,.5],[79,.5],[76,.5],[74,.5]],bass:[[48,2],[55,2],[57,2],[53,2]]},2:{bpm:120,leadWave:'square',bassWave:'triangle',lead:[[72,.5],[72,.5],[76,.5],[79,.5],[76,.5],[72,.5],[74,.5],[74,.5],[77,.5],[74,.5],[72,.5],[72,.5],[76,.5],[79,.5],[81,.5],[79,.5]],bass:[[48,1],[48,1],[55,1],[55,1],[53,1],[53,1],[55,1],[55,1]]},3:{bpm:138,leadWave:'square',bassWave:'triangle',lead:[[76,.5],[79,.5],[81,.5],[84,.5],[81,.5],[79,.5],[76,.5],[79,.5],[74,.5],[77,.5],[81,.5],[79,.5],[76,.5],[74,.5],[72,.5],[76,.5]],bass:[[48,1],[55,1],[48,1],[55,1],[53,1],[57,1],[55,1],[48,1]]},4:{bpm:112,leadWave:'triangle',bassWave:'sine',lead:[[72,.5],[76,.5],[79,.5],[81,.5],[79,.5],[76,.5],[74,.5],[72,.5],[74,.5],[77,.5],[81,.5],[84,.5],[81,.5],[79,.5],[76,.5],[74,.5]],bass:[[48,2],[53,2],[55,2],[48,2]]}},
  startBGM(track){this.bgmTrack=track;this.stopBGM();if(!track||!this.ctx||this.bgmEnabled===false)return;const t=this.tracks[track];if(!t)return;const begin=()=>{this.lead={step:0,next:this.ctx.currentTime+.1};this.bass={step:0,next:this.ctx.currentTime+.1};const beat=60/t.bpm;this.bgmTimer=setInterval(()=>{if(!this.ctx||this.ctx.state!=='running')return;const ahead=this.ctx.currentTime+.3;while(this.lead.next<ahead){const[m,b]=t.lead[this.lead.step%t.lead.length];if(m>0)this.tone(this.midi(m),b*beat*.9,{type:t.leadWave,vol:.09,when:this.lead.next-this.ctx.currentTime,dest:this.bgmGain});this.lead.next+=b*beat;this.lead.step++;}while(this.bass.next<ahead){const[m,b]=t.bass[this.bass.step%t.bass.length];if(m>0)this.tone(this.midi(m),b*beat*.95,{type:t.bassWave,vol:.05,when:this.bass.next-this.ctx.currentTime,dest:this.bgmGain});this.bass.next+=b*beat;this.bass.step++;}},120);};if(this.ctx.state==='running')begin();else this.ctx.resume().then(()=>{if(this.bgmTrack===track&&this.ctx&&this.ctx.state==='running')begin();}).catch(()=>{});},
  stopBGM(){if(this.bgmTimer){clearInterval(this.bgmTimer);this.bgmTimer=null;}},
  _lastSpokeText:'',_lastSpokeAt:0,voiceGeneration:0,idleResolvers:[],
  speak(text){
    // 未经过用户手势时不积压历史播报，避免首次触摸后一次念出整段旧日志。
    if(!this.voiceOn||!this.voiceUnlocked||!('speechSynthesis' in window)||!text)return;
    const now=Date.now();if(this._lastSpokeText===text&&now-(this._lastSpokeAt||0)<120)return;
    this._lastSpokeText=text;this._lastSpokeAt=now;this.voiceQueue.push(text);this.pumpVoice();
  },
  whenIdle(){if(!this.voiceOn||!('speechSynthesis' in window)||(!this.speaking&&!this.voiceQueue.length))return Promise.resolve();return new Promise(resolve=>this.idleResolvers.push(resolve));},
  notifyVoiceIdle(){if(this.speaking||this.voiceQueue.length)return;const waiters=this.idleResolvers.splice(0);waiters.forEach(resolve=>resolve());},
  unlockVoice(){
    if(!this.voiceOn||!('speechSynthesis' in window))return;
    this.loadVoices();
    try{speechSynthesis.resume();}catch(e){}
    if(this.voiceUnlocked){this.pumpVoice();return;}
    if(this.voiceWarming)return;
    const generation=this.voiceGeneration;
    try{
      // iOS/Android 需要在真实手势里先启动一次中文语音；静音短句只用于解锁，不改成英文。
      const u=new SpeechSynthesisUtterance('。');u.lang='zh-CN';u.rate=1.2;u.pitch=1;u.volume=0;
      if(this.zhVoice){try{u.voice=this.zhVoice;}catch(e){}}
      this.voiceUnlocked=true;this.voiceWarming=true;this.currentUtterance=u;
      let settled=false;
      const done=()=>{
        if(settled)return;settled=true;clearTimeout(timer);
        if(generation!==this.voiceGeneration)return;
        this.voiceWarming=false;if(this.currentUtterance===u)this.currentUtterance=null;this.pumpVoice();
      };
      u.onend=done;u.onerror=done;const timer=setTimeout(done,1200);
      speechSynthesis.speak(u);
    }catch(e){this.voiceUnlocked=false;this.voiceWarming=false;this.currentUtterance=null;this.voiceQueue.length=0;this.notifyVoiceIdle();}
  },
  pumpVoice(){
    if(this.speaking||this.voiceWarming)return;
    if(!this.voiceOn||!this.voiceUnlocked||!this.voiceQueue.length){if(!this.voiceOn||!this.voiceUnlocked)this.voiceQueue.length=0;this.notifyVoiceIdle();return;}
    const text=this.voiceQueue.shift(),generation=this.voiceGeneration;
    if(!this.zhVoice)this.loadVoices();
    const u=new SpeechSynthesisUtterance(text);u.lang='zh-CN';u.rate=1.05;u.pitch=1;u.volume=1;if(this.zhVoice){try{u.voice=this.zhVoice;}catch(e){}}
    this.speaking=true;this.currentUtterance=u;let settled=false;
    const done=timedOut=>{
      if(settled||generation!==this.voiceGeneration)return;settled=true;clearTimeout(timer);
      if(timedOut){try{speechSynthesis.cancel();}catch(e){}}
      this.speaking=false;if(this.currentUtterance===u)this.currentUtterance=null;this.pumpVoice();this.notifyVoiceIdle();
    };
    u.onend=()=>done(false);u.onerror=()=>done(false);const timer=setTimeout(()=>done(true),4000+text.length*180);
    try{speechSynthesis.resume();speechSynthesis.speak(u);}catch(e){done(false);}
  },
  stopVoice(){this.voiceGeneration++;if('speechSynthesis' in window){try{speechSynthesis.cancel();}catch(e){}}this.voiceQueue.length=0;this.speaking=false;this.voiceWarming=false;this.currentUtterance=null;this.notifyVoiceIdle();},
  /* 选定中文语音：部分手机默认 voice 是英文/系统音，念中文只会“滴”一声；显式挑 zh voice 可修复 */
  loadVoices(){try{if(!('speechSynthesis' in window))return;const list=speechSynthesis.getVoices()||[];const zh=list.filter(v=>/^zh[-_]?/i.test(v.lang)||/zh/i.test(v.lang)||/Chinese|Mandarin|中文|普通话/i.test(v.name||''));if(zh.length)this.zhVoice=zh[0];}catch(e){}}
};
/* 语音列表异步加载：iOS/Chrome 需在 getVoices 之后或 voiceschanged 事件里才拿得到 */
try{if('speechSynthesis' in window){AudioSys.loadVoices();if(typeof speechSynthesis.addEventListener==='function')speechSynthesis.addEventListener('voiceschanged',()=>AudioSys.loadVoices());else speechSynthesis.onvoiceschanged=()=>AudioSys.loadVoices();}}catch(e){}

/* 浏览器要求音频由用户手势启动：任何点击/触摸/按键都解锁一次，并补播排队音效 */
['pointerdown','touchstart','keydown','click'].forEach(ev=>document.addEventListener(ev,()=>{ AudioSys.unlock(); maybeStartBGM(); },{passive:true}));
/* 进入对局后若背景音乐尚未播放（如邀请链接自动进房没有按钮点击），首次手势补播 */
function maybeStartBGM(){
  if(!AudioSys.ctx||AudioSys.bgmTimer) return;
  if(mode!=='offline'&&!(mode==='online'&&roomCode)) return;
  const v=parseInt($('bgmSelect').value)||0;
  if(v) AudioSys.startBGM(v);
}

/* 一条日志 → {idx,text,cls}。严格匹配 game-core 输出格式
   带 ✖✔📞⬆💥 的是玩家动作 —— 才挂气泡 */
function dispatchLogLine(st, line){
  let m, sfx=null, voice=null, bubble=null;
  if(m=line.match(/📞\s*(.+?)\s+跟注\s+(\d+)/)){ sfx='call'; voice=`跟注 ${cnNum(+m[2])}`; }
  else if(m=line.match(/⬆\s*(.+?)\s+下注\s+(\d+)/)){ sfx='raise'; voice=`下注 ${cnNum(+m[2])}`; }
  else if(m=line.match(/⬆\s*(.+?)\s+加注到\s+(\d+)/)){ sfx='raise'; voice=`加注到 ${cnNum(+m[2])}`; }
  else if(m=line.match(/💥\s*(.+?)\s+梭哈\s+(\d+)/)){ sfx='allin'; voice=`梭哈 ${cnNum(+m[2])}`; }
  else if(m=line.match(/✖\s*(.+?)\s+弃牌/)){ sfx='fold'; voice='弃牌'; }
  else if(m=line.match(/✔\s*(.+?)\s+过牌/)){ sfx='check'; voice='过牌'; }
  else if(/——\s*翻牌\s*——/.test(line)){ sfx='flop'; /* 街道只打音效，不说话 */ }
  else if(/——\s*转牌\s*——/.test(line)){ sfx='street'; /* 街道只打音效 */ }
  else if(/——\s*河牌\s*——/.test(line)){ sfx='street'; /* 街道只打音效 */ }
  else if(/🏆/.test(line)&&/获胜|赢得/.test(line)){ voice='获胜'; }

  // 语音只播报动作本身（跟注20 / 过牌…），不带玩家名，避免不同手机 TTS 念名字出错或听感混乱

  // 气泡：只有玩家动作行（有 m）才挂
  if(m && m[1]){
    const name=m[1];
    const idx=st.players.findIndex(p=>p.name===name);
    if(idx>=0){
      let cls, txt;
      if(line.includes('弃牌')){ cls='b-fold'; txt='弃牌'; }
      else if(line.includes('过牌')){ cls='b-check'; txt='过牌'; }
      else if(line.includes('跟注')){ cls='b-call'; txt=`跟注 ${m[2]}`; }
      else if(line.includes('下注')){ cls='b-raise'; txt=`下注 ${m[2]}`; }
      else if(line.includes('加注')){ cls='b-raise'; txt=`加注到 ${m[2]}`; }
      else if(line.includes('梭哈')){ cls='b-allin'; txt=`梭哈 ${m[2]}`; }
      else { cls='b-win'; txt='获胜'; }
      if(txt) bubble={ idx, text:txt, cls };
    }
  }
  if(sfx) AudioSys.sfx(sfx);
  if(voice) AudioSys.speak(voice);
  return bubble;
}

/* 气泡：挂到牌桌层（座位自身有 z-index 会形成层叠上下文，挂在座位里永远会被别的座位盖住） */
let bubbles=new Map();
function bubbleEls(idx){ const tbl=$('table'); return tbl?tbl.querySelectorAll(`.action-bubble[data-idx="${idx}"]`):[]; }
function mountBubble(b){
  const tbl=$('table'), seat=document.querySelector(`.seat[data-idx="${b.idx}"]`);
  if(!tbl||!seat)return;
  bubbleEls(b.idx).forEach(e=>e.remove());
  const sr=seat.getBoundingClientRect(), tr=tbl.getBoundingClientRect();
  if(!tr.width)return;
  const ox=tbl.clientLeft, oy=tbl.clientTop; // 绝对定位相对 padding box，需扣掉边框
  const cx=sr.left-tr.left-ox+sr.width/2, cy=sr.top-tr.top-oy;
  const below=cy<tr.height*0.45;
  const el=document.createElement('div');
  el.className='action-bubble '+b.cls+(below?' below':'');
  el.dataset.idx=b.idx; el.textContent=b.text;
  el.style.left=cx+'px';
  el.style.top=(below?cy+sr.height+8:cy-8)+'px';
  tbl.appendChild(el);
  // 长文案（快捷语）可能横向溢出，夹在牌桌内
  const half=el.offsetWidth/2, pad=6;
  const maxX=tbl.clientWidth-half-pad, minX=half+pad;
  if(maxX>minX)el.style.left=Math.min(Math.max(cx,minX),maxX)+'px';
}
function showBubble(b){ const rec={...b}; bubbles.set(b.idx,rec); mountBubble(rec); return rec; }
function hideBubble(rec){ if(bubbles.get(rec.idx)!==rec)return; bubbles.delete(rec.idx); bubbleEls(rec.idx).forEach(e=>e.remove()); }
function restoreBubble(){ for(const [,b] of bubbles) mountBubble(b); }
addEventListener('resize',()=>{ if(bubbles.size)restoreBubble(); });

/* 快捷语（快捷语音）：分两个 Tab（赢了 / 不服），本地朗读并挂气泡；联机时广播给房间其他人 */
const EMOTE_TABS=[
  {id:'win',label:'赢了',items:[
    '哈哈，你输了！','就这？再来！','服不服？不服再来！','承让承让，下把继续！','赢你，我都不好意思了','你出牌的样子像极了新手','偷鸡成功，谢谢老板送池','我就诈一下，你还真信了','这牌你也弃？我啥都没有啊','我牌不大，但我演技大','你弃牌的样子，真可爱','整个长沙、我是老大','赢麻了，真的赢麻了','你弃牌的速度，比发牌还快','投降输一半','你犹豫那一下，我就知道你没货','不好意思，手气来了挡不住','你加注的样子，像是在给我送钱','牌没问题！'
  ]},
  {id:'lose',label:'不服',items:[
    '快点，花儿都谢了！','你出啊，我等着呢！','别跑，大战300回合！','我要验牌！','你该请我吃饭，我送你赢的','让你先高兴三分钟','你最好一直这么走运','这局不算，手滑了','来啊，谁怕谁，梭哈','我靠，我靠','手气会转，别急着笑','算你厉害','算你走运','再来，我不信邪','你赢的是这一把，不是这一晚','下一局，我连本带利','我靠，这牌也能输？','见鬼了','我怀疑你作弊，但我没证据','风水轮流转，等着','菜且嘴硬，不服就干','再来，我刚刚没认真','演技不错'
  ]}
];
const EMOTES=EMOTE_TABS.reduce((a,t)=>a.concat(t.items),[]);
function emoteIndex(id){ return lastState?lastState.players.findIndex(p=>p.id===id):-1; }
function showEmote(idx,text,speak){
  if(idx<0||!text)return;
  const rec=showBubble({ idx, text, cls:'b-emote' });
  if(speak!==false){AudioSys.sfx('emote');AudioSys.speak(text);}
  setTimeout(()=>hideBubble(rec),Math.min(6000,2400+text.length*160));
}
function sendEmote(text){
  AudioSys.unlock();
  showEmote(emoteIndex(mode==='offline'?'me':myPid),text,true);
  if(mode==='online')send({type:'emote',text});
}
/* 语音留言播放：base64 → PCM，走已解锁的 AudioContext 原声播放 */
async function playVoiceB64(b64){
  try{
    AudioSys.ensure();
    const actx=AudioSys.ctx; if(!actx)return;
    const bin=atob(b64);const buf=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i);
    const audio=await actx.decodeAudioData(buf.buffer);
    const src=actx.createBufferSource();src.buffer=audio;src.connect(actx.destination);src.start();
  }catch(e){}
}

/* ---------- 联机 ---------- */
function wsUrl(){ const p=location.protocol==='https:'?'wss':'ws'; return `${p}://${location.host}/`; }
function setConnMsg(text, ok){ const el=$('connMsg'); el.textContent=text||''; el.className='conn-msg'+(ok?' ok':''); }
function stopHeartbeat(){ if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null;} if(pongTimer){clearInterval(pongTimer);pongTimer=null;} }
function startHeartbeat(sock){
  stopHeartbeat(); lastPongAt=Date.now();
  // 心跳保活：每 20s 发一次 ping，避免后台/代理空闲超时把连接静默断开
  heartbeatTimer=setInterval(()=>{ if(sock.readyState===1){ try{sock.send(JSON.stringify({type:'ping'}));}catch(e){} } },20000);
  // 超过 45s 没收到 pong，判定连接已死，主动关掉触发重连
  pongTimer=setInterval(()=>{ if(mode!=='online')return; if(Date.now()-lastPongAt>45000){ try{sock.close();}catch(e){} } },5000);
}
function connect(pending){
  if(location.protocol==='file:'||!location.host){setConnMsg('本地文件请运行 node server.js');return;}
  if(pending&&pending.code){pendingJoinCode=pending.code;}
  if(pending&&pending.resume){suppressAutoStart=true;}
  if(ws){try{ws.onclose=null;ws.close();}catch(e){}}
  stopHeartbeat();
  setConnMsg('连接中…',true);
  let sock=null;
  try{ sock=new WebSocket(wsUrl()); }catch(e){ setConnMsg('连接失败'); return; }
  ws=sock;
  sock.onopen=()=>{ if(ws!==sock)return; reconnectTries=0; lastPongAt=Date.now(); setConnMsg('已连接',true); startHeartbeat(sock);
    // 重连成功：清掉中心区残留的“正在重连”，并立刻用最新状态刷新画面
    const m=$('message'); if(m&&/重连|断开/.test(m.textContent)) m.textContent='';
    if(pending)send(pending); if(lastState)render();
  };
  sock.onmessage=e=>{ if(ws!==sock)return; let msg; try{msg=JSON.parse(e.data);}catch(err){return;}
    if(msg.type==='pong'){ lastPongAt=Date.now(); return; }
    if(msg.type==='connected')return;
    if(msg.type==='voice'){
      // 收到语音留言：挂气泡并原声播放（发送者自己不重复播放）；找不到座位也要播放，避免静默丢声
      const v=msg.voice||{};
      if(!v.data||!v.seq||v.seq===window.__lastVoiceSeq)return;
      window.__lastVoiceSeq=v.seq;
      const vIdx=emoteIndex(v.pid);
      if(vIdx>=0)showEmote(vIdx,'语音 '+(v.dur/1000).toFixed(1)+'秒',false);
      if(v.pid!==myPid)playVoiceB64(v.data);
    }
    if(msg.type==='voice-ack'){
      const n=msg.count|0;
      showEmote(emoteIndex(myPid),n>0?('语音已送达'+cnNum(n)+'位玩家'):'没有其他在线玩家收到语音',false);
    }
    if(msg.type==='room'){ myPid=msg.pid;isOwner=msg.owner===msg.pid;roomCode=msg.code;reconnectTries=0;onJoined(); }
    else if(msg.type==='state'){
      const j=JSON.stringify(msg.state); if(j===window.__lastStateJson)return;
      window.__lastStateJson=j; lastState=msg.state;
      // 快捷语随快照下发：所有玩家都能看到/听到；发送者本人已本地显示，不重复
      const e=msg.state.emote;
      if(e&&e.seq!==window.__lastEmoteSeq){
        window.__lastEmoteSeq=e.seq;
        if(mode==='online'&&e.pid!==myPid&&Date.now()-(e.at||0)<15000)showEmote(emoteIndex(e.pid),e.text,true);
      }
      render();
    }
    else if(msg.type==='error'){
      if(/房间不存在|已失效/.test(msg.error)){
        try{ if(pendingJoinCode) localStorage.removeItem('poker_pid_'+pendingJoinCode); }catch(e){}
        roomCode=null; $('roomCode').value=''; $('btnJoin').style.display='none';
        const h=$('joinHint'); if(h)h.style.display='none';
        setConnMsg('房间不存在或已失效，请重新创建房间');
      } else setConnMsg(msg.error);
      $('message').textContent=msg.error;
    }
  };
  sock.onerror=()=>{ if(ws===sock)setConnMsg('无法连接'); };
  sock.onclose=()=>{ if(ws!==sock)return; stopHeartbeat(); if(mode!=='online'){setConnMsg('已断开');return;} if(!roomCode){setConnMsg('连接已断开，请重新创建房间');return;} setConnMsg('连接断开，正在重连…'); if($('tableWrap').style.display!=='none')$('message').textContent='连接断开，正在重连…'; scheduleReconnect(); };
}
function scheduleReconnect(immediate){
  if(reconnectTimer)return;
  // 持续重连，不再在若干次后放弃（避免“正在重连”卡死）；延迟封顶避免空转
  const delay=immediate?0:Math.min(12000,Math.round(700*Math.pow(1.6,Math.min(reconnectTries,6))));
  if(!immediate)reconnectTries++;
  reconnectTimer=setTimeout(()=>{ reconnectTimer=null; if(mode!=='online'||!roomCode)return; connect({type:'join',code:roomCode,name:($('nick').value.trim()||'玩家'),resume:myPid}); },delay);
}
function send(msg){ if(ws&&ws.readyState===1){ ws.send(JSON.stringify(msg)); return true; } if(mode==='online'){ setConnMsg('连接已断开，正在重连…'); $('message').textContent='连接已断开，正在重连…'; if(roomCode)scheduleReconnect(); } return false; }
function inviteUrl(){ const base=location.origin+location.pathname; return roomCode?base+'?room='+encodeURIComponent(roomCode):base; }
function onJoined(){ try{ if(roomCode&&myPid) localStorage.setItem('poker_pid_'+roomCode,myPid); }catch(e){} $('menu').style.display='none';$('tableWrap').style.display='grid';$('roomCodeSide').style.display=roomCode?'block':'none';$('roomCodeSide').textContent=roomCode?`房间码：${roomCode}`:'';$('inviteRow').style.display='flex';$('inviteLink').value=inviteUrl();$('btnInvite').style.display='';if(isOwner&&!suppressAutoStart)setTimeout(()=>send({type:'start'}),400);suppressAutoStart=false;}
/* 复制文本：优先 Clipboard API，降级到 execCommand，兼容 http/内嵌浏览器 */
async function copyText(text){
  if(!text) return false;
  try{ if(navigator.clipboard&&window.isSecureContext){ await navigator.clipboard.writeText(text); return true; } }catch(e){}
  try{ const ta=document.createElement('textarea'); ta.value=text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0,text.length); const ok=document.execCommand('copy'); document.body.removeChild(ta); return ok; }catch(e){ return false; }
}
async function copyInvite(btn){ const ok=await copyText(inviteUrl()); if(!ok){ $('message').textContent='复制失败，请长按邀请码手动复制：'+inviteUrl(); return false; } if(btn){ const old=btn.dataset.label||btn.textContent; btn.dataset.label=old; btn.textContent='✓ 已复制'; btn.classList.add('copied'); setTimeout(()=>{ btn.textContent=old; btn.classList.remove('copied'); },1600); } $('message').textContent='邀请链接已复制，发给好友即可加入房间 '+roomCode; return true; }

/* ---------- 单机 ---------- */
function startOffline(){ mode='offline'; table=new Core.Table({maxSeats:4}); const nick=$('nick').value.trim()||'玩家'; table.addPlayer({id:'me',name:nick,isHuman:true}); table.addPlayer({id:'b1',name:'AI·稳健',isBot:true,personality:0}); table.addPlayer({id:'b2',name:'AI·凶猛',isBot:true,personality:2}); table.addPlayer({id:'b3',name:'AI·机灵',isBot:true,personality:1}); $('menu').style.display='none';$('tableWrap').style.display='grid'; startHandOffline(); }
function botDecide(t,p){ return Core.botDecide(t,p); }

/* 单机调度会等待当前语音和气泡播完，再允许下一次行动或发牌。 */
let botTimer=null,botToken=0;
const announcedSeqs=new Set();
let presentedHandNo=null,presentationGen=0,pendingPresentations=0,presenting=false,focusId=null,detailOpen=false,presentationWatchdog=null;
let presentationDone=Promise.resolve();
function startHandOffline(){
  if(mode!=='offline')return;
  AudioSys.ensure();AudioSys.stopBGM();AudioSys.startBGM(parseInt($('bgmSelect').value));
  if(botTimer){clearTimeout(botTimer);botTimer=null;}
  botToken++;
  table.startHand();
  lastState=table.snapshot('me');
  render();
  scheduleOfflineBot();
}

function scheduleOfflineBot(){
  const token=++botToken;
  if(botTimer){clearTimeout(botTimer);botTimer=null;}
  Promise.resolve(presentationDone).then(()=>{
    if(token!==botToken||mode!=='offline'||!table||table.over)return;
    if(table.needsRunout){
      botTimer=setTimeout(()=>{
        botTimer=null;if(token!==botToken||!table.needsRunout)return;
        table.advanceRunout();lastState=table.snapshot('me');render();scheduleOfflineBot();
      },650);
      return;
    }
    const p=table.players[table.current];
    if(!p||!p.isBot)return;
    AudioSys.ensure();
    botTimer=setTimeout(()=>{
      botTimer=null;if(token!==botToken||!table||table.over)return;
      const cur=table.players[table.current];
      if(!cur||!cur.isBot||cur.id!==p.id)return;
      const la=table.legalActions(cur),stage=table.stage,cmd=botDecide(table,cur),r=table.act(cur.id,cmd);
      if(r.ok&&cmd.type==='raise'){
        cur.raiseCount=cur.raiseStage===stage?(cur.raiseCount||0)+1:1;
        cur.raiseStage=stage;
      }
      if(!r.ok){if(la.check)table.act(cur.id,{type:'check'});else if(la.call)table.act(cur.id,{type:'call'});else table.act(cur.id,{type:'fold'});}
      lastState=table.snapshot('me');render();scheduleOfflineBot();
    },450);
  });
}

function doAction(action){ AudioSys.ensure(); if(mode==='online'){send({type:'action',action});return;} if(!table||presenting)return;const r=table.act('me',action); if(r.ok){lastState=table.snapshot('me');render();scheduleOfflineBot();} }

/* ---------- 渲染 ---------- */
function strCardHTML(s,down){ if(down)return'<div class="card back"></div>'; const m=s.match(/([0-9]+|J|Q|K|A)([♠♥♦♣])/); const red=m[2]==='♥'||m[2]==='♦'; return`<div class="card ${red?'red':''}"><span>${m[1]}</span><span class="s">${m[2]}</span></div>`; }

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function updateFocus(){
  document.querySelectorAll('.seat').forEach(seat=>{
    const p=lastState&&lastState.players[+seat.dataset.idx];
    seat.classList.toggle('active',!!p&&p.id===focusId&&!lastState.over);
  });
}
function resetPresentation(handNo){
  presentationGen++;presentedHandNo=handNo;pendingPresentations=0;presenting=false;focusId=null;
  if(presentationWatchdog){clearTimeout(presentationWatchdog);presentationWatchdog=null;}
  presentationDone=Promise.resolve();announcedSeqs.clear();bubbles.clear();detailOpen=false;
  document.querySelectorAll('.action-bubble').forEach(e=>e.remove());AudioSys.stopVoice();
}
async function presentLogLine(st,line,gen){
  if(gen!==presentationGen)return;
  const bubble=dispatchLogLine(st,line);
  if(bubble){
    focusId=st.players[bubble.idx]?.id||null;updateFocus();
    const rec=showBubble(bubble);
    // 只在语音真正结束后再收起气泡；语音关闭时保留一段可读时间
    await Promise.all([AudioSys.whenIdle(),wait(bubble.cls==='b-allin'?1100:600)]);
    if(gen===presentationGen)hideBubble(rec);
    return;
  }
  const street=/——\s*(翻牌|转牌|河牌)\s*——/.test(line);
  const winning=/🏆/.test(line);
  await Promise.all([AudioSys.whenIdle(),wait(street?550:winning?1000:40)]);
}

function render(){
  const st=lastState; if(!st) return;
  if(st.handNo!==presentedHandNo)resetPresentation(st.handNo);
  document.querySelectorAll('.seat').forEach(e=>e.remove());
  const tableEl=$('table');
  const kb=$('btnKickBot');
  if(kb) kb.style.display=(mode==='online'&&st.players.some(p=>p.isBot))?'':'none';

  // 每手按 handNo 重置、按 seq 去重；动作逐条播完再进入下一动作。
  const entries=st.log.filter(e=>!announcedSeqs.has(e.seq));
  if(entries.length){
    entries.forEach(e=>announcedSeqs.add(e.seq));
    const gen=presentationGen;pendingPresentations++;presenting=true;
    // 看门狗：真实语音/浏览器异常导致播报链卡住时，强制释放，避免整局卡死
    if(presentationWatchdog)clearTimeout(presentationWatchdog);
    presentationWatchdog=setTimeout(()=>{
      presentationWatchdog=null;
      if(gen!==presentationGen||!presenting)return;
      presentationGen++;pendingPresentations=0;presenting=false;AudioSys.stopVoice();
      focusId=lastState?lastState.current:null;updateFocus();
      if(lastState){renderControls(lastState);renderResult(lastState);}
      if(mode==='offline')scheduleOfflineBot();
    },15000);
    presentationDone=presentationDone.then(async()=>{
      for(const e of entries){if(gen!==presentationGen)return;await presentLogLine(st,e.msg,gen);}
    }).catch(err=>{
      if(window.console)console.warn('播报链异常，已跳过本段',err);
    }).then(()=>{
      if(gen!==presentationGen)return;
      pendingPresentations--;
      if(pendingPresentations<=0){
        pendingPresentations=0;presenting=false;
        if(presentationWatchdog){clearTimeout(presentationWatchdog);presentationWatchdog=null;}
        focusId=lastState.current;updateFocus();
        renderControls(lastState);renderResult(lastState);
      }
    });
  }

  const winnerIds=new Set();
  if(st.over&&st.payout) st.payout.forEach(p=>p.winners.forEach(w=>winnerIds.add(w)));
  const meId=mode==='offline'?'me':myPid;
  const meIdx=Math.max(0,st.players.findIndex(p=>p.id===meId));
  const order=st.players.map((p,i)=>i).sort((a,b)=>{ if(a===meIdx)return -1; if(b===meIdx)return 1; return a-b; });
  order.forEach((i,pos)=>{
    const p=st.players[i];
    const position=getPos(st.players.length)[pos%4];
    const seat=document.createElement('div');
    const isMe = p.id === meId;
    seat.className='seat'+(isMe?' me':'')+(p.id===(presenting?focusId:st.current)&&!st.over?' active':'')+(p.folded?' folded':'')+(p.allin?' allin':'')+(winnerIds.has(p.id)?' winner':'');
    seat.dataset.idx=i; seat.style.left=position.x+'%'; seat.style.top=position.y+'%';
    const tags=[];
    const n=st.players.length,sbIdx=n===2?st.dealer:(st.dealer+1)%n,bbIdx=n===2?(st.dealer+1)%n:(st.dealer+2)%n;
    if(i===st.dealer)tags.push({label:'庄',cls:'dealer'});
    if(i===sbIdx)tags.push({label:'小盲',cls:'sb'});
    if(i===bbIdx)tags.push({label:'大盲',cls:'bb'});
    if(p.allin)tags.push({label:'梭哈',cls:'allin'});
    let holeHTML;
    const reveal=st.over||st.stage==='showdown';
    if(p.hole&&(reveal||!p.folded)) holeHTML=p.hole.map(c=>strCardHTML(c,false)).join('');
    else holeHTML='<div class="card back"></div><div class="card back"></div>';
    const foldBadge=p.folded?'<div class="fold-badge">已弃牌</div>':'';
    const startChips=st.startChips||{};
    const delta=st.over&&startChips[p.id]!=null?p.chips-startChips[p.id]:null;
    const deltaHTML=delta!=null&&delta!==0?`<div class="d-delta ${delta>0?'pos':'neg'}">${delta>0?'+':''}${delta}</div>`:'';
    seat.innerHTML=`<div class="seat-body"><div class="seat-info"><span class="name">${esc(p.name)}</span><span class="chips">${p.chips}</span>${tags.length?`<span class="tags">${tags.map(t=>`<span class="tag ${t.cls}">${t.label}</span>`).join('')}</span>`:''}</div><div class="cards">${holeHTML}</div></div><div class="handinfo">${esc(p.hand||'')}</div><div class="bet">${p.bet>0&&!st.over?`<span class="bet-chip">${p.bet}</span>`:''}</div>${deltaHTML}${foldBadge}`;
    tableEl.appendChild(seat);
  });
  restoreBubble();
  $('community').innerHTML=st.community.length
    ? st.community.map(c=>strCardHTML(c,false)).join('')
    : '<div class="card empty"></div>'.repeat(5);
  const wonTotal=st.over&&st.payout?st.payout.reduce((s,x)=>s+(x.amount||0),0):0;
  $('pot').textContent=st.over&&wonTotal?('本手奖池 '+wonTotal):('奖池 '+st.pot);
  const stageName={preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌',showdown:'摊牌',idle:'准备开始'}[st.stage]||st.stage;
  $('stage').style.display=st.over?'none':'';
  $('stage').textContent=st.over?'':st.needsRunout?('等待摊牌：'+stageName):('阶段：'+stageName+' · 最高下注 '+st.highBet);
  const me=st.players.find(p=>p.id===meId);
  const msgEl=$('message');
  const hasResult=!!(st.over&&st.payout&&st.payout.length);
  if(hasResult&&isGameOver(st)&&window.__gameOverHandNo!==st.handNo){ window.__gameOverHandNo=st.handNo; detailOpen=true; }
  if(hasResult){
    const startChips=st.startChips||{};
    const myDelta=me&&startChips[me.id]!=null?me.chips-startChips[me.id]:0;
    if(window.__soundHandNo!==st.handNo){ window.__soundHandNo=st.handNo; if(myDelta>0) AudioSys.sfx(myDelta>=200?'bigwin':'coin'); else if(myDelta<0) AudioSys.sfx('lose'); }
    // 赢家按“净赢分”判断（payout 只代表分到奖池，边池可能让输家也出现在 winners 里）
    const netWinners=st.players.filter(p=>{ const s0=startChips[p.id]!=null?startChips[p.id]:p.chips; return p.chips-s0>0; });
    const winNames=netWinners.map(p=>p.id===meId?'你':p.name);
    msgEl.className='message win-msg';
    const trophy=document.createElement('span'); trophy.className='win-trophy'; trophy.textContent='🏆';
    const sub=document.createElement('span'); sub.className='win-sub'; sub.textContent=`你 ${myDelta>0?'+':''}${myDelta}`;
    const title=myDelta>0?'你 赢了':(winNames.length?`${winNames.join('、')} 获胜`:'平局');
    msgEl.textContent='';
    msgEl.append(trophy, document.createTextNode(' '+title), sub);
  } else { msgEl.className='message'; msgEl.textContent=''; }
  const logEl=$('log'); logEl.textContent='';
  st.log.slice(-80).forEach(l=>{ const d=document.createElement('div'); d.textContent=l.msg; logEl.appendChild(d); });
  logEl.scrollTop=logEl.scrollHeight;
  renderResult(st); renderControls(st);
}

/* 破产即结束：单机/联机都一样，只要有玩家积分输光，本局不再开下一手 */
function isGameOver(st){ return !!st&&!!st.over&&!!(st.payout&&st.payout.length)&&st.players.some(p=>p.chips<=0); }
function renderResult(st){
  const overlay=$('resultOverlay');
  if(!st.over||presenting||!detailOpen){ overlay.style.display='none'; overlay.innerHTML=''; $('controls').style.visibility=''; return; }
  const gameOver=isGameOver(st);
  const meId=mode==='offline'?'me':myPid;
  const start=st.startChips||{};
  const rows=st.players.map(p=>{ const s0=start[p.id]!=null?start[p.id]:p.chips; return { id:p.id, name:p.name, delta:p.chips-s0, chips:p.chips, isHuman:p.id===meId }; });
  const me=rows.find(r=>r.id===meId)||rows[0];
  const cls=me.delta>0?'win':me.delta<0?'lose':'draw';
  const title=gameOver?'游戏结束':me.delta>0?'胜利！':me.delta<0?'失败':'平局';
  const dCls=me.delta>0?'pos':me.delta<0?'neg':'';
  const dText=gameOver?'有玩家积分已输光':(me.delta>0?'赢 +':'输 ')+Math.abs(me.delta);
  const rowHTML=rows.map(r=>{ const rc=r.delta>0?'pos':r.delta<0?'neg':''; const sign=r.delta>0?'+':''; return `<div class="result-row"><span>${esc(r.name)}${r.isHuman?'（你）':''}</span><span class="r-pos ${rc}">${sign}${r.delta}</span><span>剩余 ${r.chips}</span></div>`; }).join('');
  $('controls').style.visibility='hidden';
  overlay.style.display='flex';
  overlay.innerHTML=`<div class="result-panel"><div class="result-title ${gameOver?'draw':cls}">${title}</div><div class="result-delta ${dCls}">${gameOver?'':'本局'}${dText}${gameOver?'':' 积分'}</div><div class="result-rows">${rowHTML}</div><div class="result-actions"><button class="btn-continue" id="btnContinue">${gameOver?'重新开始':'继续游戏'}</button><button class="secondary" id="btnCloseDetail">关闭明细</button></div></div>`;
  $('btnContinue').onclick=()=>{ detailOpen=false; $('btnNewHand').click(); };
  $('btnCloseDetail').onclick=()=>{ detailOpen=false; overlay.style.display='none'; $('controls').style.visibility=''; };
  overlay.onclick=e=>{ if(e.target===overlay){ detailOpen=false; overlay.style.display='none'; $('controls').style.visibility=''; } };
}

/* 控件懒创建，不重建 DOM */
function showWaiting(box,text){
  if(box._waitText===text)return;
  box._waitText=text;box._init=false;box.quickOpen=false;box.raiseFocus=false;
  box.innerHTML=`<div class="waiting"><span class="dot"></span>${text}</div>`;
}
/* 快捷加注：按底池倍数直接执行，不用再点加注 */
function quickRaise(st,frac){
  const id=mode==='offline'?'me':myPid;
  const me=st.players.find(p=>p.id===id);
  if(!me||presenting||st.over||st.needsRunout)return;
  const callAmt=Math.max(0,st.highBet-me.bet);
  const minTo=st.highBet+(st.minRaise||20), maxTo=me.bet+me.chips;
  if(maxTo<minTo){ doAction({type:'allin'}); return; }
  const to=Math.max(minTo,Math.min(maxTo,me.bet+callAmt+Math.round((st.pot||0)*frac)));
  doAction({type:'raise',to});
}
/* 留言入口：进牌桌即创建（悬浮在牌桌左下角，不依赖轮次）；点一下=文字输入，长按0.5秒=录音，最长20秒 */
function ensureChatRow(box){
  if(box.chatRow&&box.chatRow.isConnected)return;
  box.chatRow=document.createElement('div'); box.chatRow.className='chat-row';
  box.micBtn=document.createElement('button'); box.micBtn.type='button'; box.micBtn.className='btn-mic'; box.micBtn.title='快捷语';
  box.micBtn.innerHTML='<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  box.chatInput=document.createElement('input'); box.chatInput.type='text'; box.chatInput.maxLength=40; box.chatInput.placeholder='说点啥…'; box.chatInput.autocomplete='off'; box.chatInput.style.display='none';
  box.chatSend=document.createElement('button'); box.chatSend.type='button'; box.chatSend.className='btn-chat-send'; box.chatSend.textContent='发送'; box.chatSend.style.display='none';
  box.recBar=document.createElement('div'); box.recBar.className='rec-bar'; box.recBar.style.display='none';
  box.recBar.innerHTML='<span class="rec-dot"></span><span class="rec-time">0.0s / 20s</span><span class="rec-hint">松手发送</span>';
  box.chatRow.appendChild(box.micBtn); box.chatRow.appendChild(box.chatInput); box.chatRow.appendChild(box.chatSend); box.chatRow.appendChild(box.recBar);
  box.parentElement.appendChild(box.chatRow);
  const toggleChat=show=>{ box.chatInput.style.display=show?'':'none'; box.chatSend.style.display=show?'':'none'; box.recBar.style.display='none'; if(show)setTimeout(()=>box.chatInput.focus(),0); else box.chatInput.value=''; };
  let pressTimer=null,recorder=null,recChunks=[],recStart=0,recTick=null,recording=false,recDiscard=false,pressed=false;
  const REC_MAX=20000;
  const chatToast=text=>showEmote(emoteIndex(mode==='offline'?'me':myPid),text,false);
  const recUI=on=>{ box.recBar.style.display=on?'':'none'; box.chatInput.style.display='none'; box.chatSend.style.display='none'; box.chatInput.value=''; box.micBtn.classList.toggle('rec-on',on); };
  const startRec=async()=>{
    if(recording)return;
    if(mode!=='online'){chatToast('语音留言仅联机房间可用');return;}
    if(!window.isSecureContext){chatToast('录音需要 https 或 localhost，局域网 IP 访问浏览器会禁止麦克风');return;}
    if(!navigator.mediaDevices||!window.MediaRecorder){chatToast('当前浏览器不支持录音');return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      // 首次录音会弹浏览器权限框；若弹窗期间用户已松手，直接取消本次录音，避免"允许后一直红色录音"
      if(!pressed){ stream.getTracks().forEach(t=>t.stop()); return; }
      const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':(MediaRecorder.isTypeSupported('audio/mp4')?'audio/mp4':'');
      recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:64000});
      recChunks=[];recStart=Date.now();recording=true;recDiscard=false;
      recorder.ondataavailable=e=>{ if(e.data&&e.data.size)recChunks.push(e.data); };
      recorder.onstop=()=>{
        stream.getTracks().forEach(t=>t.stop());
        const dur=Date.now()-recStart;
        const blob=new Blob(recChunks,{type:mime||'audio/webm'});recChunks=[];
        if(recDiscard)return;
        if(dur<600){chatToast('说话太短，已取消');return;}
        if(!blob.size)return;
        const r=new FileReader();
        r.onload=()=>{
          const b64=String(r.result).split(',')[1]||'';
          if(b64.length>240000){chatToast('语音过长，发送失败');return;}
          send({type:'voice',mime:blob.type,dur,data:b64});
          showEmote(emoteIndex(myPid),'语音 '+(dur/1000).toFixed(1)+'秒',false);
          playVoiceB64(b64);
        };
        r.readAsDataURL(blob);
      };
      recorder.start();
      recUI(true);
      recTick=setInterval(()=>{
        const s=(Date.now()-recStart)/1000;
        const el=box.recBar.querySelector('.rec-time');
        if(el)el.textContent=s.toFixed(1)+'s / 20s';
        if(Date.now()-recStart>=REC_MAX)stopRec(false);
      },100);
    }catch(err){
      if(err&&err.name==='NotAllowedError')chatToast('麦克风权限被拒绝，请在浏览器设置中允许');
      else chatToast('录音启动失败');
    }
  };
  const stopRec=discard=>{
    if(!recording)return;
    recording=false;recDiscard=!!discard;clearInterval(recTick);recTick=null;
    recUI(false);
    try{recorder.stop();}catch(e){}
  };
  box.micBtn.addEventListener('contextmenu',e=>e.preventDefault());
  box.micBtn.onpointerdown=e=>{
    if(e.button===2)return;
    pressed=true;
    try{box.micBtn.setPointerCapture(e.pointerId);}catch(_){}
    pressTimer=setTimeout(()=>{ pressTimer=null; startRec(); },500);
  };
  box.micBtn.onpointerup=()=>{
    pressed=false;
    if(pressTimer){ clearTimeout(pressTimer);pressTimer=null; toggleChat(box.chatInput.style.display==='none'); }
    else if(recording)stopRec(false);
  };
  box.micBtn.onpointercancel=()=>{ pressed=false; if(pressTimer){clearTimeout(pressTimer);pressTimer=null;} if(recording)stopRec(true); };
  const sendChat=()=>{
    const text=(box.chatInput.value||'').trim().slice(0,40);
    if(!text)return;
    box.chatInput.value=''; toggleChat(false);
    sendEmote(text);
  };
  box.chatSend.onclick=sendChat;
  box.chatInput.onkeydown=e=>{ if(e.key==='Enter'){e.preventDefault();sendChat();} };
  box.parentElement.addEventListener('click',e=>{ if(box.chatInput.style.display!=='none'&&!box.chatRow.contains(e.target))toggleChat(false); });
}
function renderControls(st){
  const box=$('controls');
  if(presenting){ showWaiting(box,'发牌 · 行动播报中…'); return; }
  ensureChatRow(box);
  box._waitText=null;
  if(st.over&&st.payout&&st.payout.length){
    box.innerHTML=''; box._init=false;
    const det=document.createElement('button'); det.className='btn-detail'; det.textContent='明细';
    det.onclick=()=>{ detailOpen=true; renderResult(lastState); };
    box.appendChild(det);
    const nb=document.createElement('button'); nb.className='btn-continue'; nb.textContent=isGameOver(st)?'重新开始':'继续游戏'; nb.onclick=()=>$('btnNewHand').click();
    box.appendChild(nb); return;
  }
  const me=st.players.find(p=>p.id===myPid||(mode==='offline'&&p.id==='me'));
  if(!me||me.folded||me.allin||st.needsRunout||st.current!==me.id){
    box.innerHTML=''; box._init=false;
    const cur=st.players.find(p=>p.id===st.current);
    showWaiting(box,cur?`${cur.name} 思考中…`:(st.needsRunout?'正在发牌…':'等待中…'));
    return;
  }

  // 【Bug 修复】AI 回合时我们把 DOM 清空 + _init 重置为 false
  // 所以每次轮到玩家时，_init 都是 false → 会重新创建按钮 DOM
  if(!box._init){
    box.innerHTML=''; box._init=true;
    box.foldBtn=document.createElement('button'); box.foldBtn.className='btn-fold'; box.foldBtn.textContent='弃牌';
    box.foldBtn.onclick=()=>doAction({type:'fold'}); box.appendChild(box.foldBtn);
    box.chkBtn=document.createElement('button'); box.chkBtn.className='btn-call'; box.chkBtn.textContent='过牌';
    box.chkBtn.onclick=()=>doAction({type:'check'}); box.appendChild(box.chkBtn);
    box.clBtn=document.createElement('button'); box.clBtn.className='btn-call';
    box.clBtn.onclick=()=>doAction({type:'call'}); box.appendChild(box.clBtn);
    box.raiseRow=document.createElement('div'); box.raiseRow.className='raise-row';
    box.raiseInput=document.createElement('input'); box.raiseInput.type='number';
    if(window.matchMedia&&matchMedia('(pointer:coarse)').matches) box.raiseInput.readOnly=true; // 手机点输入框弹出快捷加注，不弹键盘
    box.raiseBtn=document.createElement('button'); box.raiseBtn.className='btn-raise'; box.raiseBtn.textContent='加注';
    box.raiseBtn.onclick=()=>{ let to=parseInt(box.raiseInput.value)||(st.highBet+(st.minRaise||20)); to=Math.max(box.raiseInput.min|0,Math.min(box.raiseInput.max|0,to)); doAction({type:'raise',to}); };
    box.raiseInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){ box.raiseBtn.click(); } });
    box.raiseInput.addEventListener('focus',()=>{ box.raiseFocus=true; box.quickOpen=true; box.quickRow.style.display=''; });
    box.raiseInput.addEventListener('click',()=>{ box.raiseFocus=true; box.quickOpen=true; box.quickRow.style.display=''; });
    box.raiseInput.addEventListener('blur',()=>{ box.raiseFocus=false; setTimeout(()=>{ if(!box.raiseFocus){ box.quickOpen=false; box.quickRow.style.display='none'; } },200); });
    box.quickRow=document.createElement('div'); box.quickRow.className='quick-raise'; box.quickRow.style.display='none';
    const mkQuick=(label,fn)=>{ const qb=document.createElement('button'); qb.type='button'; qb.className='btn-quick'; qb.textContent=label; qb.onpointerdown=e=>e.preventDefault(); qb.onclick=()=>{ const s=lastState; if(!s)return; box.quickOpen=false; box.quickRow.style.display='none'; fn(s); }; box.quickRow.appendChild(qb); };
    [['½池',.5],['1池',1],['2池',2]].forEach(([label,frac])=>mkQuick(label,s=>quickRaise(s,frac)));
    mkQuick('梭哈',()=>doAction({type:'allin'}));
    box.appendChild(box.quickRow);
    box.raiseRow.appendChild(box.raiseInput); box.raiseRow.appendChild(box.raiseBtn); box.appendChild(box.raiseRow);
    box.allinBtn=document.createElement('button'); box.allinBtn.className='btn-allin'; box.allinBtn.textContent='梭哈';
    box.allinBtn.onclick=()=>doAction({type:'allin'}); box.appendChild(box.allinBtn);
  }

  const callAmt=Math.max(0,st.highBet-me.bet);
  const minTo=st.highBet+(st.minRaise||20);
  const maxTo=me.bet+me.chips;
  const needsCheck = callAmt===0;
  box.chkBtn.style.display = needsCheck ? '' : 'none';
  box.clBtn.style.display = needsCheck ? 'none' : '';
  box.clBtn.textContent = `跟注 ${Math.min(callAmt,me.chips)}`;
  const canRaise = maxTo>=minTo && st.raisesThisStreet<(st.maxRaises||4);
  box.raiseRow.style.display = canRaise ? '' : 'none';
  box.quickRow.style.display = canRaise && box.quickOpen ? '' : 'none';
  if(canRaise){ box.raiseInput.min=minTo; box.raiseInput.max=maxTo; if(!box.raiseFocus) box.raiseInput.value=minTo; }
  // 底部独立“梭哈”按钮只在无法加注（加注封顶/不够最小加注）但仍可全下时出现；平时走输入框弹出的快捷梭哈
  box.allinBtn.style.display = (!canRaise && me.chips>0) ? '' : 'none';
}

/* ---------- 事件绑定 ---------- */
function audioWake(){ AudioSys.ensure(); AudioSys.startBGM(parseInt($('bgmSelect').value)); }
$('btnOffline').onclick=()=>{ audioWake(); startOffline(); };
$('btnCreate').onclick=()=>{ mode='online'; audioWake(); connect({type:'create',name:$('nick').value.trim()||'玩家'}); };
$('btnJoin').onclick=()=>{ mode='online'; audioWake(); connect({type:'join',code:$('roomCode').value.trim(),name:$('nick').value.trim()||'玩家'}); };
$('btnNewHand').onclick=()=>{ detailOpen=false; newHand(); };
/* 有人破产游戏结束 → 重新开始：所有玩家积分清零；否则正常开下一手（保留积分） */
function newHand(){
  const over=isGameOver(lastState);
  if(mode==='online'){ send(over?{type:'reset'}:{type:'start'}); return; }
  if(table&&over) table.resetGame();
  startHandOffline();
}
$('btnAddBot').onclick=()=>{ if(mode==='online') send({type:'add-bot'}); };
$('btnCopy').onclick=()=>{ copyInvite($('btnCopy')); };
$('btnExport').onclick=()=>{ const ev=mode==='offline'?table.events:(lastState&&lastState.events)||[]; const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),events:ev},null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='record-data.json';a.click(); };
/* 音频控件同时绑定 input + change：部分手机只触发其中一种，确保选“关闭”/调音量都生效 */
const bindBoth=(el,fn)=>{['input','change'].forEach(ev=>el.addEventListener(ev,fn));};
const applyBGM=val=>{ AudioSys.ensure(); AudioSys.startBGM(parseInt(val)||0); const a=$('bgmSelect'),b=$('bgmModalSelect'); if(a)a.value=val; if(b)b.value=val; };
const applyVoice=on=>{ AudioSys.voiceOn=on; const a=$('voiceToggle'),b=$('voiceModalToggle'); if(a)a.checked=on; if(b)b.checked=on; if(on){AudioSys.unlock();AudioSys.pumpVoice();}else AudioSys.stopVoice(); };
const applyVol=val=>{ const a=$('volume'),b=$('volumeModal'); if(a)a.value=val; if(b)b.value=val; AudioSys.ensure(); AudioSys.volume(); AudioSys.muted=false; const mb=$('btnBgm'); if(mb){mb.style.opacity='';mb.style.textDecoration='';} };
const applyBgmEnabled=on=>{ AudioSys.bgmEnabled=on; if(on)AudioSys.startBGM(parseInt($('bgmModalSelect').value)||parseInt($('bgmSelect').value)||0); else AudioSys.stopBGM(); const c=$('bgmModalToggle'); if(c)c.checked=on; };
bindBoth($('bgmSelect'),e=>applyBGM(e.target.value));
bindBoth($('voiceToggle'),e=>applyVoice(e.target.checked));
bindBoth($('volume'),e=>applyVol(e.target.value));

function openModal(id){ $(id).style.display='flex'; }
function closeModal(id){ $(id).style.display='none'; }
document.querySelectorAll('.modal-overlay').forEach(ov=>{ ov.addEventListener('click',e=>{ if(e.target===ov) ov.style.display='none'; }); });
document.querySelectorAll('.modal-close').forEach(b=>{ b.onclick=()=>closeModal(b.dataset.close); });
/* 音乐按钮：单击开弹窗；短时双击=整体静音，再双击恢复 */
let bgmClickAt=0,bgmClickTimer=null;
$('btnBgm').onclick=()=>{
  const now=Date.now();
  if(now-bgmClickAt<320){
    clearTimeout(bgmClickTimer);bgmClickTimer=null;bgmClickAt=0;
    AudioSys.ensure();
    AudioSys.muted=!AudioSys.muted;
    if(AudioSys.muted){ if(AudioSys.master)AudioSys.master.gain.value=0; }
    else AudioSys.volume();
    const mb=$('btnBgm'); mb.style.opacity=AudioSys.muted?'.45':''; mb.style.textDecoration=AudioSys.muted?'line-through':'';
    return;
  }
  bgmClickAt=now;
  bgmClickTimer=setTimeout(()=>{ bgmClickTimer=null;bgmClickAt=0; $('bgmModalSelect').value=$('bgmSelect').value; $('voiceModalToggle').checked=AudioSys.voiceOn; const tc=$('bgmModalToggle'); if(tc)tc.checked=AudioSys.bgmEnabled!==false; $('volumeModal').value=$('volume').value; openModal('bgmModal'); },330);
};
$('btnHelp').onclick=()=>openModal('helpModal');
$('btnEmote').onclick=()=>{
  const box=$('emoteList');
  if(!box.dataset.init){
    box.dataset.init='1';
    EMOTE_TABS.forEach(t=>{
      t.items.forEach(text=>{
        const b=document.createElement('button'); b.type='button'; b.className='emote-item'; b.dataset.tab=t.id; b.textContent=text;
        b.onclick=()=>{ closeModal('emoteModal'); sendEmote(text); };
        box.appendChild(b);
      });
    });
    const switchTab=(id)=>{
      box.dataset.tab=id;
      document.querySelectorAll('#emoteTabs .emote-tab').forEach(tb=>tb.classList.toggle('active',tb.dataset.tab===id));
      box.querySelectorAll('.emote-item').forEach(it=>{ it.style.display=it.dataset.tab===id?'':'none'; });
    };
    document.querySelectorAll('#emoteTabs .emote-tab').forEach(tb=>{ tb.onclick=()=>switchTab(tb.dataset.tab); });
    switchTab(box.dataset.tab||'win');
  }
  openModal('emoteModal');
};
$('btnInvite').onclick=()=>{ copyInvite($('btnInvite')); };
$('btnKickBot').onclick=()=>{ AudioSys.unlock(); send({type:'kick-bot'}); };
bindBoth($('bgmModalSelect'),e=>applyBGM(e.target.value));
bindBoth($('voiceModalToggle'),e=>applyVoice(e.target.checked));
bindBoth($('bgmModalToggle'),e=>applyBgmEnabled(e.target.checked));
bindBoth($('volumeModal'),e=>applyVol(e.target.value));

let resizeTimer=null;
window.addEventListener('resize',()=>{ clearTimeout(resizeTimer); resizeTimer=setTimeout(()=>{ if(lastState) render(); },200); });
window.addEventListener('orientationchange',()=>setTimeout(()=>{ if(lastState) render(); },300));
/* 切回前台时自愈：后台会挂起 setTimeout/语音播报，可能导致“正在思考/正在重连”卡死 */
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible')return;
  AudioSys.unlock();
  if(presenting||pendingPresentations>0){
    presentationGen++;pendingPresentations=0;presenting=false;
    if(presentationWatchdog){clearTimeout(presentationWatchdog);presentationWatchdog=null;}
    AudioSys.stopVoice();
  }
  if(mode==='online'){
    if(!ws||ws.readyState!==1) scheduleReconnect(true);
    else lastPongAt=Date.now();
  }
  if(lastState) render();
});

(function(){
  try{ const saved=localStorage.getItem('poker_nick'); if(saved)$('nick').value=saved; }catch(e){}
  $('nick').addEventListener('change',e=>{ try{ localStorage.setItem('poker_nick',e.target.value.trim()); }catch(err){} });
  // 昵称候选下拉：自定义实现，替代部分手机不显示的 <datalist>
  const NICK_OPTS=['赌神','赌后','赌王','赌圣','扑克王子','扑克公主','梭哈哥','梭哈姐','偷鸡姐','黑桃皇后'];
  const nickInput=$('nick'), nickDd=$('nickDropdown');
  if(nickInput&&nickDd){
    nickDd.innerHTML=NICK_OPTS.map(n=>`<button type="button" class="nick-opt">${esc(n)}</button>`).join('');
    const showDd=()=>{ nickDd.style.display='block'; };
    const hideDd=()=>{ nickDd.style.display='none'; };
    nickInput.addEventListener('focus',showDd);
    nickInput.addEventListener('click',showDd);
    nickInput.addEventListener('input',hideDd); // 开始输入自定义昵称时收起候选，避免遮挡下方按钮
    nickDd.addEventListener('pointerdown',e=>{ const b=e.target.closest('.nick-opt'); if(!b)return; e.preventDefault(); nickInput.value=b.textContent; try{ localStorage.setItem('poker_nick',nickInput.value.trim()); }catch(err){} hideDd(); nickInput.blur(); });
    document.addEventListener('pointerdown',e=>{ if(!nickDd.contains(e.target)&&e.target!==nickInput) hideDd(); });
  }
  const q=new URLSearchParams(location.search); const r=q.get('room');
  if(!r) return;
  const code=r.toUpperCase();
  $('roomCode').value=code;
  const nick=$('nick').value.trim();
  let resumePid=null; try{ resumePid=localStorage.getItem('poker_pid_'+code); }catch(e){}
  if(nick){
    // 已设置过昵称：通过邀请链接直接进入房间；若本地存有该房间 pid，刷新后复用原座位接续对局
    setConnMsg('正在加入房间 '+code+'…',true);
    mode='online';
    const joinMsg={type:'join',code,name:nick}; if(resumePid) joinMsg.resume=resumePid;
    connect(joinMsg);
  } else {
    // 未设置昵称：停留首页，显示「加入房间」按钮，填好昵称再加入
    $('btnJoin').style.display='';
    const h=$('joinHint'); if(h){ h.style.display=''; h.textContent='邀请链接带入房间 '+code+'，请先设置昵称，再点「加入房间」'; }
    setConnMsg('请先设置昵称',false);
    $('nick').focus();
  }
})();
