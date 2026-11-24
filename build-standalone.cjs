// 生成单机离线 standalone 与发布用 .deploy/index.html（外链 CSS/JS 全部内联）
const fs = require('fs');
const path = require('path');
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');
const core = fs.readFileSync(path.join(root, 'src/game-core.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

let out = html;

// 1) 内联样式
out = out.replace(/<link rel="stylesheet" href="\/style\.css[^"]*">/, '<style>\n' + css + '\n</style>');

// 2) 内联引擎与前端脚本
out = out.replace(/<script src="\/src\/game-core\.js[^"]*"><\/script>/, '<script>\n' + core + '\n</script>');
out = out.replace(/<script src="\/app\.js[^"]*"><\/script>/, '<script>\n' + app + '\n</script>');

// 3) 隐藏联机入口（CSS，不删 DOM，避免 onclick 绑定 null）
const hideCss = `<style>
#btnCreate,#btnJoin,#roomCode,label[style="margin-top:14px"]{display:none!important}
</style>`;
out = out.replace('</head>', hideCss + '\n</head>');

// 4) 替换提示文案为离线说明
out = out.replace(
  '联机需用源码包启动本地 Node 服务（npm install && npm start）后访问 http://localhost:3000，好友凭房间码入座；空位可添加 AI 补位。纯娱乐虚拟积分，仅供练习。',
  '离线单机版：直接点「单机练习」与 AI 对战，无需联网。纯娱乐虚拟积分，仅供练习。'
);

// 5) 写产物
const up = path.join(root, '..');
fs.writeFileSync(path.join(up, 'card-standalone.html'), out);
fs.mkdirSync(path.join(root, '.deploy'), { recursive: true });
fs.writeFileSync(path.join(root, '.deploy/index.html'), out);
console.log('standalone + deploy 生成完成, 字节:', out.length);
