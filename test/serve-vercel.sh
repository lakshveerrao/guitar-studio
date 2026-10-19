#!/bin/bash
# Vercel version locally: real Redis + fake ElevenLabs + the API function. Leaves servers running.
cd "$(dirname "$0")/.."
pkill -f "dev/local[.]mjs" ; pkill -f "test/mock/eleve[n]" ; pkill -f "node_modules/wrangle[r]" ; pkill -f "workerd-linux-64/bin/worker[d]" ; redis-cli -p 6390 shutdown nosave >/dev/null 2>&1 ; sleep 1
rm -rf /tmp/ak-files
redis-server --port 6390 --save "" --appendonly no --daemonize yes >/dev/null
setsid node test/mock/eleven.mjs > /tmp/ak-mock.log 2>&1 &
REDIS_URL=redis://127.0.0.1:6390 ELEVENLABS_API_KEY=test-key ELEVENLABS_BASE=http://127.0.0.1:9099 ADMIN_TOKEN=admin-token-1234567890 AI_DAILY_CAP=5 LOCAL_FILES=/tmp/ak-files \
  setsid node dev/local.mjs > /tmp/ak-local.log 2>&1 &
for i in $(seq 30); do curl -s http://127.0.0.1:8787/api/health >/dev/null && break; sleep 0.5; done
curl -s http://127.0.0.1:8787/api/health; echo
