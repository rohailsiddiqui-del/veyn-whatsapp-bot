#!/bin/bash
# Run this on the GCP server to deploy the portal
# Usage: bash portal/deploy.sh

set -e
BOT_DIR=~/whatsapp-bot

echo "=== Installing API dependencies ==="
cd $BOT_DIR/portal/api
npm install

echo "=== Building Next.js frontend ==="
cd $BOT_DIR/portal/frontend
npm install
npm run build

echo "=== Registering with PM2 ==="
cd $BOT_DIR

# API server
pm2 describe veyn-portal-api > /dev/null 2>&1 && pm2 restart veyn-portal-api || \
  pm2 start portal/api/server.mjs --name veyn-portal-api --env production

# Next.js frontend
pm2 describe veyn-portal-ui > /dev/null 2>&1 && pm2 restart veyn-portal-ui || \
  pm2 start "npm run start" --name veyn-portal-ui --cwd portal/frontend

pm2 save

echo ""
echo "=== Portal deployed ==="
echo "Frontend: http://$(curl -s ifconfig.me):3000"
echo "API:      http://$(curl -s ifconfig.me):3001"
echo ""
echo "Default password: veyn2024"
echo "Set PORTAL_PASSWORD env var to change it."
