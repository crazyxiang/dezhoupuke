# 一键部署脚本：把当前项目发布到线上站点
# 用法： .\deploy.ps1
# 可选： .\deploy.ps1 -Desc "本次改动说明"
param(
  [string]$Title = '德州扑克在线对局',
  [string]$Desc  = '同步本地最新代码'
)
# 注意：不要用 Stop —— PS5 会把 CLI 的 stderr 进度信息当异常中断脚本
$ErrorActionPreference = 'Continue'
$exe  = Join-Path $env:USERPROFILE '.trae-cn\plugins\trae-remote-official\deployment\0.0.43\skills\deployment\bin\win32-x64\trae-deploy.exe'
$site = '37lhohd7h71iwoq13j4'
$url  = 'https://37lhohd7h71iwoq13j4.traesite.cn'
$proj = $PSScriptRoot
$t0 = Get-Date

# 1) 组装临时源码包（纯复制，无 npm，几秒完成）
$src = Join-Path ([System.IO.Path]::GetTempPath()) ('poker-deploy-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $src | Out-Null
foreach ($f in 'server.js','package.json','package-lock.json') { Copy-Item (Join-Path $proj $f) $src }
foreach ($d in 'public','src','vendor') { Copy-Item (Join-Path $proj $d) (Join-Path $src $d) -Recurse }
foreach ($f in 'build.sh','run.sh','exec-config.json') { Copy-Item (Join-Path $proj ('deploy\' + $f)) $src }

# 2) 上传并创建部署
Write-Host '[1/3] 打包上传并创建部署...'
$out = & $exe 'deployments' 'create' '--site-id' $site '--title' $Title '--description' $Desc '--type' 'function-web' '--source-dir' $src '--execution-config' (Join-Path $src 'exec-config.json') '--app-tags' '189' 2>$null
$json = ($out -join "`n") | ConvertFrom-Json
if (-not $json.ok) { Write-Host ($out -join "`n"); exit 1 }
$depId = $json.data.deployment_id
if (-not $depId) { $depId = $json.data.deployment.deployment_id }
Write-Host ("      部署 ID: {0}" -f $depId)

# 3) 等待构建发布完成（status: 9=成功 10=失败 11=已取消）
Write-Host '[2/3] 等待构建发布...'
$names = @{'1'='排队';'2'='构建中';'3'='产物审计';'4'='发布准备';'5'='URL审计';'6'='发布中';'7'='下线中';'8'='释放资源';'12'='提升中'}
$st = 0
for ($i = 1; $i -le 30; $i++) {
  $wout = & $exe 'deployments' 'wait' '--deployment-id' $depId '--timeout-seconds' '60' 2>$null
  $wj = ($wout -join "`n") | ConvertFrom-Json
  $st = [int]$wj.data.deployment.status
  $sec = [int]((Get-Date) - $t0).TotalSeconds
  if ($st -eq 9) { Write-Host ("[3/3] 部署成功，耗时 {0} 秒：{1}" -f $sec, $url); break }
  if ($st -eq 10 -or $st -eq 11) { Write-Host ("部署{0}（阶段 {1}）：{2}" -f $names["$st"], $wj.data.deployment.current_stage, ($wj.data | ConvertTo-Json -Depth 5)); break }
  Write-Host ("  [{0}s] {1}..." -f $sec, $names["$st"])
}

Remove-Item $src -Recurse -Force -ErrorAction SilentlyContinue
if ($st -ne 9) { exit 1 }
