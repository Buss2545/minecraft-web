#!/usr/bin/env bash
# รันชุดทดสอบทั้งหมด (ต้องมี Node และ Playwright + Chromium: npm i -g playwright) • ใช้: bash tests/run.sh
cd "$(dirname "$0")/.."; export NODE_PATH="${NODE_PATH:-$(npm root -g)}"; rc=0
node tests/owner.test.mjs || rc=1
node --import ./tests/cf-register.mjs tests/version-api.test.mjs || rc=1
for t in monk gym cave-can status-panel input-switch streamer-start daily auto-update auto-update-modes login-refresh logout-lb-refresh; do node "tests/$t.test.js" || rc=1; done
[ $rc = 0 ] && echo "✅ ผ่านทั้งหมด" || echo "❌ มีข้อที่ล้มเหลว"; exit $rc
