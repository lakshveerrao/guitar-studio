# airkords.com

## What's here
| Part | File | What it does |
|---|---|---|
| Motion | `public/js/core/motion.js` | Remote packets → strokes, neck tilt, neck slide, pick mode, auto setup |
| Chords | `public/js/core/chords.js` | Chord shapes, power chords, neck position, which strings a stroke hits, key guessing |
| Sound | `public/js/core/sound.js` | Real guitar + bass samples, acoustic/rock/metal amps, slides, studio polish, drums |
| Guitar | `public/js/core/instrument.js` | Joins motion + chords + sound, feeds the band, records |
| AI Band | `public/js/core/band.js` | Follows your strumming tempo, drums + bass |
| Recording | `public/js/core/performance.js` | Recorder, Enhance, AI alignment, validation |
| Publish | `public/js/core/songmaker.js` | Rough / Enhance / Create a song |
| Playback | `public/js/core/player.js` | Plays songs back, renders to WAV |
| Website API | `src/worker.js` | Songs, likes, plays, reports, leaderboard, ElevenLabs |

## How you play (fret remote = left hand, strum remote = right hand)
- **Front/back:** tilt the neck up or down to pick the chord row.
- **Left/right:** slide your hand along the neck. Each slide moves 2 frets, and ringing strings bend to the new notes.
- **Pads 1-3:** which chord in the row.
- **Strum size:** a small flick plays 1-2 strings, a full swing all 6. Down-strokes start on the thick strings, up-strokes on the thin ones.
- **Pick mode (optional):** the height of your strumming hand chooses the string.
- **Wrist twist (optional):** 3 more chord banks.

No firmware change is needed.

## Pages
- `/`: homepage, with a "try it" string demo, how to play, the three sounds, the charts, the build log and the story.
- `/play`: the guitar app. Connect both remotes, run setup, play, record, then publish Rough, Enhanced or as an AI song.
- `/songs`: the charts, sorted by Top (likes + plays), New or Most played, and filtered by type.
- `/song/<id>`: one song, with playback, its chords, lyrics (AI songs), likes, sharing and reporting. Shared links show the song's title.

## Going live on Vercel
1. In Vercel, open the project and connect two stores from the **Storage** tab:
   - **Redis** (Upstash or Redis Cloud), for songs, likes, plays and the charts. It adds `REDIS_URL` / `KV_URL`.
   - **Blob**, for recordings and AI audio. It adds `BLOB_READ_WRITE_TOKEN`.
2. **Settings → Environment Variables:** add `ELEVENLABS_API_KEY`. Optionally add `ADMIN_TOKEN` and `IP_SALT` (any random text).
3. **Redeploy.** `/api/health` should then show `"db":true` and `"ai":true`.
4. Optional: in **Domains**, add `airkords.com`.

The build step (`scripts/fetch-media.sh`) copies the build-log photos from the old airkords.com, if that site is still up.

AI cost limits (optional environment variables): `AI_DAILY_CAP` = 40 a day for the whole site, `AI_PER_IP` = 3 a day per person.
To take a song down: `curl -X POST https://<site>/api/admin/songs/<id> -H "authorization: Bearer <ADMIN_TOKEN>" -d '{"action":"hide"}'` (or `delete`).

Cloudflare is also supported: see `wrangler.toml`, `schema.sql` and `src/worker.js`.

## Tests
`npm test` · `python3 test/browser.test.py` · `bash test/serve-vercel.sh && python3 test/site.test.py && python3 test/ui.test.py` (needs `redis-server`)

## Credits
The guitar and bass samples are FluidR3_GM by Frank Wen, used under CC BY 3.0 (see `public/CREDITS.txt`). The site footer must credit them.
