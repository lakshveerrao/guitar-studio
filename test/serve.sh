#!/bin/bash
# Local site for manual checks: fresh DB, fake ElevenLabs, placeholder photos. Leaves servers running.
cd "$(dirname "$0")/.."
pkill -f "node_modules/wrangler" ; pkill -f "workerd-linux-64/bin/workerd" ; pkill -f "test/mock/eleven" ; pkill -f "npm exec wrangler" ; sleep 1
rm -rf .wrangler/state
mkdir -p public/media; for f in test/media-placeholders/*; do [ -f "public/media/$(basename $f)" ] || cp "$f" public/media/; done
npx wrangler d1 execute airkords --local --file schema.sql >/dev/null 2>&1
setsid node test/mock/eleven.mjs > /tmp/ak-mock.log 2>&1 &
setsid npx wrangler dev --local --port 8787 --ip 127.0.0.1 --var ELEVENLABS_API_KEY:test-key --var ELEVENLABS_BASE:http://127.0.0.1:9099 --var ADMIN_TOKEN:admin-token-1234567890 > /tmp/ak-wrangler.log 2>&1 &
for i in $(seq 60); do curl -s http://127.0.0.1:8787/api/health >/dev/null && break; sleep 1; done
echo ready
