// airkords.com — Cloudflare Worker: website files + song API + AI song backing (ElevenLabs).
//
// Secrets (set with `npx wrangler secret put NAME`, never in code):
//   ELEVENLABS_API_KEY   for Create-a-song
//   ADMIN_TOKEN          optional, for taking songs down: POST /api/admin/songs/:id {action}
// Bindings: DB (D1), FILES (R2), ASSETS (the public/ folder)

import { validatePerformance } from "../public/js/core/performance.js";
import { clean, NICK_RE, VOTER_RE, compose } from "../server/common.js";

const JSON_HDR = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HDR });
const err = (status, message) => json({ error: message }, status);
const today = () => new Date().toISOString().slice(0, 10);
const now = () => Date.now();

export default {
  async fetch(req, env, ctx){
    const url = new URL(req.url);
    const sm = url.pathname.match(/^\/song\/([a-z0-9]{10})\/?$/);
    if(sm) return songPage(req, env, url, sm[1]);
    if(!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try { return await route(req, env, url); }
    catch(e){
      if(e.status === 413) return err(413, "That's too big to upload");
      if(e.status === 400) return err(400, "Bad request");
      console.error(e); return err(500, "Something went wrong");
    }
  }
};

async function route(req, env, url){
  const p = url.pathname, m = req.method;
  let mt;
  if(p === "/api/health") return json({ ok: true, ai: !!env.ELEVENLABS_API_KEY });
  if(p === "/api/songs" && m === "GET") return listSongs(env, url);
  if(p === "/api/songs" && m === "POST") return publish(req, env);
  if((mt = p.match(/^\/api\/songs\/([a-z0-9]{10})$/)) && m === "GET") return getSong(env, mt[1], url);
  if((mt = p.match(/^\/api\/songs\/([a-z0-9]{10})\/(like|play|report)$/)) && m === "POST") return act(req, env, mt[1], mt[2]);
  if((mt = p.match(/^\/api\/backing\/([a-z0-9]{12})$/)) && m === "GET") return getBacking(env, mt[1], req);
  if(p === "/api/ai/backing" && m === "POST") return makeBacking(req, env);
  if((mt = p.match(/^\/api\/admin\/songs\/([a-z0-9]{10})$/)) && m === "POST") return admin(req, env, mt[1]);
  return err(404, "Not found");
}

// ---------- helpers ----------
function rid(n){ const a = "abcdefghijkmnpqrstuvwxyz23456789"; const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map(x => a[x % a.length]).join(""); }
async function ipHash(req, env){
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode((env.IP_SALT || "airkords") + ip));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function body(req, max = 1_000_000){
  const len = +(req.headers.get("content-length") || 0);
  if(len > max) throw Object.assign(new Error("too big"), { status: 413 });
  const text = await req.text();
  if(text.length > max) throw Object.assign(new Error("too big"), { status: 413 });
  try { return JSON.parse(text || "{}"); } catch(e){ throw Object.assign(new Error("bad json"), { status: 400 }); }
}
// count against a daily limit; returns false when over
async function take(env, key, limit){
  const day = today();
  const r = await env.DB.prepare("INSERT INTO quota (k, day, n) VALUES (?, ?, 1) ON CONFLICT(k, day) DO UPDATE SET n = n + 1 RETURNING n").bind(key, day).first();
  return r.n <= limit;
}
async function give(env, key){ await env.DB.prepare("UPDATE quota SET n = MAX(0, n - 1) WHERE k = ? AND day = ?").bind(key, today()).run(); }
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// ---------- songs ----------
async function listSongs(env, url){
  const sort = url.searchParams.get("sort") || "top";
  const limit = Math.max(1, Math.min(50, num(url.searchParams.get("limit"), 20)));
  const offset = Math.max(0, Math.min(5000, num(url.searchParams.get("offset"), 0)));
  const mode = url.searchParams.get("mode");
  const order = sort === "new" ? "created_at DESC"
              : sort === "plays" ? "plays DESC, created_at DESC"
              : sort === "likes" ? "likes DESC, created_at DESC"
              : "(likes * 5 + plays) DESC, created_at DESC";       // top = likes and plays together
  const where = ["hidden = 0"], args = [];
  if(["rough","enhanced","song"].includes(mode)){ where.push("mode = ?"); args.push(mode); }
  const rows = await env.DB.prepare(
    `SELECT id, nickname, title, mode, voice, bpm, duration_ms, likes, plays, created_at, backing_id IS NOT NULL AS has_backing
     FROM songs WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).bind(...args, limit, offset).all();
  return json({ songs: rows.results.map((r, i) => ({ ...r, rank: offset + i + 1, has_backing: !!r.has_backing })), sort, offset, limit });
}

async function getSong(env, id, url){
  const s = await env.DB.prepare("SELECT * FROM songs WHERE id = ? AND hidden = 0").bind(id).first();
  if(!s) return err(404, "Song not found");
  const obj = await env.FILES.get(`songs/${id}.json`);
  if(!obj) return err(404, "Song data missing");
  const voter = url.searchParams.get("voter");
  let liked = false;
  if(voter && VOTER_RE.test(voter)) liked = !!(await env.DB.prepare("SELECT 1 FROM likes WHERE song_id = ? AND voter = ?").bind(id, voter).first());
  const { voter: _v, ip_hash: _i, reports: _r, hidden: _h, ...pub } = s;
  return json({ song: { ...pub, liked, backing_url: s.backing_id ? `/api/backing/${s.backing_id}` : null }, performance: await obj.json() });
}

async function publish(req, env){
  const b = await body(req);
  const voter = String(b.voter || ""), nickname = String(b.nickname || "").trim(), title = String(b.title || "").trim() || "Untitled jam";
  if(!VOTER_RE.test(voter)) return err(400, "Missing player id");
  if(!NICK_RE.test(nickname)) return err(400, "Nickname must be 2-20 letters or numbers");
  if(title.length > 40) return err(400, "Title is too long (40 max)");
  if(!clean(nickname) || !clean(title)) return err(400, "Please choose a different nickname or title");
  if(!["rough","enhanced","song"].includes(b.mode)) return err(400, "Bad mode");
  const perf = b.performance, bad = validatePerformance(perf);
  if(bad) return err(400, "Recording is not valid: " + bad);
  if(perf.events.filter(e => e.e === "note" || e.e === "chuck").length < 4) return err(400, "Play a few more strums before publishing");

  let backingId = null, lyrics = null;
  if(b.mode === "song"){
    backingId = String(b.backingId || "");
    const job = /^[a-z0-9]{12}$/.test(backingId) && await env.DB.prepare("SELECT * FROM ai_jobs WHERE id = ?").bind(backingId).first();
    if(!job || job.voter !== voter) return err(400, "Make the AI song first");
    if(job.used) return err(400, "That AI song was already published");
    lyrics = job.lyrics;
  } else if(perf.backing) return err(400, "Only AI songs have a backing track");

  const ip = await ipHash(req, env);
  if(!(await take(env, "pub:" + ip, num(env.PUBLISH_PER_IP, 30)))) return err(429, "You've published a lot today — try again tomorrow");

  const id = rid(10);
  await env.FILES.put(`songs/${id}.json`, JSON.stringify(perf), { httpMetadata: { contentType: "application/json" } });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO songs (id, nickname, title, mode, voice, bpm, duration_ms, backing_id, lyrics, voter, ip_hash, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, nickname, title, b.mode, perf.voice, perf.tempo?.bpm ?? null, Math.round(perf.duration * 1000), backingId, lyrics, voter, ip, now()),
    ...(backingId ? [env.DB.prepare("UPDATE ai_jobs SET used = 1 WHERE id = ?").bind(backingId)] : [])
  ]);
  return json({ id, url: `/song/${id}` }, 201);
}

async function act(req, env, id, what){
  const b = await body(req, 10_000), voter = String(b.voter || "");
  if(!VOTER_RE.test(voter)) return err(400, "Missing player id");
  const s = await env.DB.prepare("SELECT id, likes, plays, reports FROM songs WHERE id = ? AND hidden = 0").bind(id).first();
  if(!s) return err(404, "Song not found");
  const ip = await ipHash(req, env);
  if(what === "like"){
    if(!(await take(env, "like:" + ip, 300))) return err(429, "Too many likes today");
    const had = await env.DB.prepare("SELECT 1 FROM likes WHERE song_id = ? AND voter = ?").bind(id, voter).first();
    const liked = !had;
    await env.DB.batch(liked
      ? [env.DB.prepare("INSERT INTO likes (song_id, voter, created_at) VALUES (?, ?, ?)").bind(id, voter, now()),
         env.DB.prepare("UPDATE songs SET likes = likes + 1 WHERE id = ?").bind(id)]
      : [env.DB.prepare("DELETE FROM likes WHERE song_id = ? AND voter = ?").bind(id, voter),
         env.DB.prepare("UPDATE songs SET likes = MAX(0, likes - 1) WHERE id = ?").bind(id)]);
    const r = await env.DB.prepare("SELECT likes FROM songs WHERE id = ?").bind(id).first();
    return json({ liked, likes: r.likes });
  }
  if(what === "play"){
    // one play per listener per song per day
    const r = await env.DB.prepare("INSERT OR IGNORE INTO plays (song_id, voter, day) VALUES (?, ?, ?)").bind(id, voter, today()).run();
    if(r.meta.changes && await take(env, "play:" + ip, 2000)) await env.DB.prepare("UPDATE songs SET plays = plays + 1 WHERE id = ?").bind(id).run();
    const p = await env.DB.prepare("SELECT plays FROM songs WHERE id = ?").bind(id).first();
    return json({ plays: p.plays });
  }
  // report: 3 different people -> hidden until checked
  const reason = String(b.reason || "").slice(0, 200);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO reports (song_id, voter, reason, created_at) VALUES (?, ?, ?, ?)").bind(id, voter, reason, now()).run();
  if(r.meta.changes) await env.DB.prepare("UPDATE songs SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?").bind(num(env.REPORTS_TO_HIDE, 3), id).run();
  return json({ reported: true });
}

async function getBacking(env, id, req){
  const obj = await env.FILES.get(`backing/${id}`);
  if(!obj) return err(404, "Not found");
  const h = new Headers({ "content-type": obj.httpMetadata?.contentType || "audio/mpeg", "cache-control": "public, max-age=31536000, immutable" });
  return new Response(obj.body, { headers: h });
}

async function admin(req, env, id){
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if(!env.ADMIN_TOKEN || tok.length < 16 || tok !== env.ADMIN_TOKEN) return err(401, "No");
  const { action } = await body(req, 1000);
  if(action === "hide" || action === "unhide") await env.DB.prepare("UPDATE songs SET hidden = ? WHERE id = ?").bind(action === "hide" ? 1 : 0, id).run();
  else if(action === "delete"){ await env.DB.prepare("DELETE FROM songs WHERE id = ?").bind(id).run(); await env.FILES.delete(`songs/${id}.json`); }
  else return err(400, "action must be hide, unhide or delete");
  return json({ ok: true });
}

async function makeBacking(req, env){
  if(!env.ELEVENLABS_API_KEY) return err(503, "AI songs aren't switched on yet");
  const b = await body(req, 20_000);
  const voter = String(b.voter || "");
  if(!VOTER_RE.test(voter)) return err(400, "Missing player id");
  const bpm = Math.round(num(b.bpm, 0)), durationMs = Math.round(num(b.durationMs, 0));
  if(!(bpm >= 60 && bpm <= 200)) return err(400, "Tempo must be 60-200 BPM");
  if(!(durationMs >= 8000 && durationMs <= 180000)) return err(400, "Songs can be 8 seconds to 3 minutes");
  if(!["acoustic","rock","metal"].includes(b.voice)) return err(400, "Bad sound");
  const key = String(b.key || "C major").slice(0, 12);
  if(!/^[A-G][#b]? (major|minor)$/.test(key)) return err(400, "Bad key");
  const progression = (Array.isArray(b.progression) ? b.progression : []).slice(0, 16).map(String).filter(c => /^[A-G][#b]?[a-z0-9]{0,5}$/.test(c));
  if(!progression.length) return err(400, "No chords");
  const theme = String(b.theme || "").replace(/[\r\n{}\[\]]/g, " ").trim().slice(0, 100);
  if(theme && !clean(theme)) return err(400, "Please choose a different song idea");

  // rate limits: they cost real money
  const ip = await ipHash(req, env);
  const okGlobal = await take(env, "ai:all", num(env.AI_DAILY_CAP, 40));
  const okIp = await take(env, "ai:" + ip, num(env.AI_PER_IP, 3));
  const okVoter = await take(env, "aiv:" + voter, num(env.AI_PER_IP, 3));
  if(!okGlobal || !okIp || !okVoter){
    await Promise.all([give(env, "ai:all"), give(env, "ai:" + ip), give(env, "aiv:" + voter)]);
    return err(429, !okGlobal ? "The AI band is resting — lots of songs today. Try again tomorrow!" : "You've made your AI songs for today. Try again tomorrow!");
  }

  const brief = { voice: b.voice, bpm, key, progression, durationMs, theme };
  try {
    const out = await compose(env, brief);
    const id = rid(12);
    await env.FILES.put(`backing/${id}`, out.audio, { httpMetadata: { contentType: out.type } });
    await env.DB.prepare("INSERT INTO ai_jobs (id, voter, ip_hash, title, lyrics, bpm, duration_ms, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, voter, ip, out.title || null, out.lyrics || null, bpm, durationMs, out.model, now()).run();
    return json({ backingId: id, url: `/api/backing/${id}`, lyrics: out.lyrics || "", bpm, durationMs, model: out.model });
  } catch(e){
    await Promise.all([give(env, "ai:all"), give(env, "ai:" + ip), give(env, "aiv:" + voter)]);   // failed: don't count it
    console.error("elevenlabs", e.message);
    return err(502, e.userMessage || "The AI couldn't make this song. Try again in a minute.");
  }
}

// /song/:id — the song page, with the song's own title for link previews
async function songPage(req, env, url, id){
  const page = await env.ASSETS.fetch(new Request(new URL("/song", url), { headers: req.headers }));
  let s = null;
  try { s = await env.DB.prepare("SELECT title, nickname, mode, voice FROM songs WHERE id = ? AND hidden = 0").bind(id).first(); } catch(e){}
  if(!s) return new Response(page.body, { status: 404, headers: page.headers });
  const what = { rough: "played in the air", enhanced: "played in the air", song: "an AI song built around a guitar played in the air" }[s.mode];
  const title = `${s.title} by ${s.nickname} — AirKords`, desc = `Listen to “${s.title}” by ${s.nickname}, ${what} on AirKords.`;
  const set = (attr, v) => ({ element(e){ e.setAttribute(attr, v); } });
  return new HTMLRewriter()
    .on("title", { element(e){ e.setInnerContent(title); } })
    .on('meta[name="description"]', set("content", desc))
    .on('meta[property="og:title"]', set("content", title))
    .on('meta[property="og:description"]', set("content", desc))
    .transform(new Response(page.body, { status: 200, headers: page.headers }));
}
