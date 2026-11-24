import Core from './src/game-core.js';
const { Table, botDecide } = Core;

// 4 个 AI 自己打自己
let flops=0, showdowns=0, total=20;
for(let h=1;h<=total;h++){
  const t=new Table({maxSeats:4});
  t.addPlayer({id:'a',name:'稳健',isBot:true,personality:0});
  t.addPlayer({id:'b',name:'凶猛',isBot:true,personality:2});
  t.addPlayer({id:'c',name:'机灵',isBot:true,personality:1});
  t.addPlayer({id:'d',name:'稳柔',isBot:true,personality:0});
  t.startHand();
  let step=0, enteredFlop=false;
  while(!t.over && step<200){
    if(t.needsRunout){t.advanceRunout();continue;}
    const p=t.players[t.current];
    t.act(p.id, botDecide(t,p)); step++;
    if(t.stage==='flop') enteredFlop=true;
  }
  if(enteredFlop)flops++;
  if(t.over)showdowns++;
}
console.log(`4 AI 对打 ${total} 手: 进flop=${flops} 进摊牌=${showdowns}`);
