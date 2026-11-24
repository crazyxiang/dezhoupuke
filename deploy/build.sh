#!/bin/sh
# 构建脚本：纯文件复制（依赖已内置在 vendor/，无需 npm 安装，部署速度最快）
set -eu
mkdir -p dist
cp server.js package.json package-lock.json dist/
cp -R public dist/public
cp -R src dist/src
mkdir -p dist/node_modules
cp -R vendor/ws dist/node_modules/ws
cp run.sh dist/run.sh
chmod 755 dist/run.sh
