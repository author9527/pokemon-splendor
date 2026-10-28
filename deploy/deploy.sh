#!/bin/bash
# 璀璨宝石·宝可梦 部署脚本（幂等，可重复执行）
set -e
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[1/3] 安装 nginx 路由配置..."
sudo cp "$REPO_DIR/deploy/nginx-splendor.conf" /opt/gem/nginx/splendor.conf

echo "[2/3] 校验配置..."
sudo nginx -c /opt/gem/nginx.conf -t

echo "[3/3] 重载 nginx..."
sudo nginx -s reload

echo "部署完成：游戏地址 = 环境预览地址 + /splendor/"
echo "本地自检：curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/splendor/"
