#!/bin/bash
# Fresh local site + fake ElevenLabs, then the end-to-end tests.
cd "$(dirname "$0")/.."
stop(){ pkill -f "node_modules/wrangler" ; pkill -f "workerd-linux-64/bin/workerd" ; pkill -f "test/mock/eleven" ; pkill -f "npm exec wrangler" ; } 2>/dev/null
stop; sleep 1
rm -rf .wrangler/state
npx wrangler d1 execute airkords --local --file schema.sql >/dev/null 2>&1
setsid node test/mock/eleven.mjs > /tmp/ak-mock.log 2>&1 &
setsid npx wrangler dev --local --port 8787 --ip 127.0.0.1 --var ELEVENLABS_API_KEY:test-key --var ELEVENLABS_BASE:http://127.0.0.1:9099 \
  --var ADMIN_TOKEN:admin-token-1234567890 --var AI_DAILY_CAP:5 > /tmp/ak-wrangler.log 2>&1 &
for i in $(seq 60); do curl -s http://127.0.0.1:8787/api/health >/dev/null && break; sleep 1; done
python3 test/site.test.py > /tmp/ak-site-results.txt 2>&1; code=$?
stop
exit $code
