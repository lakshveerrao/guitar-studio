// airkords.com on Vercel — the song API, backed by Redis (likes, plays, charts) and Vercel Blob (recordings, AI audio).
//
// Environment (set in Vercel → Project → Settings → Environment Variables, never in code):
//   ELEVENLABS_API_KEY            for Create-a-song
//   REDIS_URL (or KV_URL)         added automatically when you connect a Redis database in Vercel → Storage
//   BLOB_READ_WRITE_TOKEN         added automatically when you connect Blob in Vercel → Storage
//   ADMIN_TOKEN (optional)        for taking songs down
//   AI_DAILY_CAP=40, AI_PER_IP=3, PUBLISH_PER_IP=30, REPORTS_TO_HIDE=3 (optional limits)

import { createClient } from "redis";
import { validatePerformance } from "../public/js/core/performance.js";
import { clean, NICK_RE, VOTER_RE, compose } from "./common.js";
import * as files from "./files.js";

const JSON_HDR = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HDR });
const err = (status, message) => json({ error: message }, status);
const today = () => new Date().toISOString().slice(0, 10);
const now = () => Date.now();
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const env = process.env;

// ---------- Redis (one connection reused between requests) ----------
let client = null, connecting = null;
export async function redis(){
  if(client?.isReady) return client;
  if(!connecting){
    const url = env.REDIS_URL || env.KV_URL;
    if(!url) throw Object.assign(new Error("No database connected"), { status: 503, userMessage: "The song database isn't connected yet." });
    const c = createClient({ url });
    c.on("error", (e) => console.error("redis", e.message));
    connecting = c.connect().then(() => { client = c; connecting = null; return c; }, (e) => { connecting = null; throw e; });
  }
  return connecting;
}

// Data model
//   song:<id>            hash with the song's details
//   z:<sort>[:<mode>]    sorted sets for the charts (only visible songs): new | top | plays | likes
//   likes:<id>           set of player ids who liked it
//   plays:<id>:<day>     set of player ids who played it today (expires)
//   reports:<id>         set of player ids who reported it
//   ai:<id>              hash for an AI backing track
//   q:<key>:<day>        daily counters for limits
const SORTS = ["new", "top", "plays", "likes"];
const MODES = ["rough", "enhanced", "song"];
function scores(s){
  const t = +s.created_at, tie = t / 1e13;              // newer wins ties
  return { new: t, top: (+s.likes)*5 + (+s.plays) + tie, plays: +s.plays + tie, likes: +s.likes + tie };
}
async function index(r, s){
  const sc = scores(s), m = r.multi();
  for(const k of SORTS){ m.zAdd("z:" + k, { score: sc[k], value: s.id }); m.zAdd(`z:${k}:${s.mode}`, { score: sc[k], value: s.id }); }
  await m.exec();
}
async function unindex(r, s){
  const m = r.multi();
  for(const k of SORTS){ m.zRem("z:" + k, s.id); m.zRem(`z:${k}:${s.mode}`, s.id); }
  await m.exec();
}

// ---------- helpers ----------
function rid(n){ const a = "abcdefghijkmnpqrstuvwxyz23456789"; const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map(x => a[x % a.length]).join(""); }
async function ipHash(req){
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
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
async function take(r, key, limit){
  const k = `q:${key}:${today()}`;
  const n = await r.incr(k); if(n === 1) await r.expire(k, 60*60*48);
  return n <= limit;
}
async function give(r, key){ await r.decr(`q:${key}:${today()}`); }
const pub = (s) => ({ id: s.id, nickname: s.nickname, title: s.title, mode: s.mode, voice: s.voice, bpm: s.bpm ? +s.bpm : null,
  duration_ms: +s.duration_ms, backing_id: s.backing_id || null, lyrics: s.lyrics || null, likes: +s.likes, plays: +s.plays, created_at: +s.created_at });

// ---------- entry ----------
export async function handle(req){
  const url = new URL(req.url);
  try {
    const sm = url.pathname.match(/^\/song\/([a-z0-9]{10})\/?$/);
    if(sm) return await songPage(req, url, sm[1]);
    return await route(req, url);
  } catch(e){
    if(e.status === 413) return err(413, "That's too big to upload");
    if(e.status === 400) return err(400, "Bad request");
    if(e.status === 503) return err(503, e.userMessage);
    console.error(e); return err(500, "Something went wrong");
  }
}

async function route(req, url){
  const p = url.pathname, m = req.method;
  let mt;
  if(p === "/api/health") return json({ ok: true, ai: !!env.ELEVENLABS_API_KEY, db: !!(env.REDIS_URL || env.KV_URL), files: files.mode() });
  if(p === "/api/songs" && m === "GET") return listSongs(url);
  if(p === "/api/songs" && m === "POST") return publish(req);
  if((mt = p.match(/^\/api\/songs\/([a-z0-9]{10})$/)) && m === "GET") return getSong(mt[1], url);
  if((mt = p.match(/^\/api\/songs\/([a-z0-9]{10})\/(like|play|report)$/)) && m === "POST") return act(req, mt[1], mt[2]);
  if((mt = p.match(/^\/api\/backing\/([a-z0-9]{12})$/)) && m === "GET") return getBacking(mt[1]);
  if(p === "/api/ai/backing" && m === "POST") return makeBacking(req);
  if((mt = p.match(/^\/api\/admin\/songs\/([a-z0-9]{10})$/)) && m === "POST") return admin(req, mt[1]);
  return err(404, "Not found");
}

// ---------- songs ----------
async function listSongs(url){
  const r = await redis();
  const sort = SORTS.includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "top";
  const limit = Math.max(1, Math.min(50, num(url.searchParams.get("limit"), 20)));
  const offset = Math.max(0, Math.min(5000, num(url.searchParams.get("offset"), 0)));
  const mode = url.searchParams.get("mode");
  const key = MODES.includes(mode) ? `z:${sort}:${mode}` : `z:${sort}`;
  const ids = await r.zRange(key, offset, offset + limit - 1, { REV: true });
  const m = r.multi(); ids.forEach(id => m.hGetAll("song:" + id));
  const rows = ids.length ? await m.exec() : [];
  const songs = rows.filter(s => s && s.id && s.hidden !== "1").map((s, i) => {
    const { lyrics, backing_id, ...rest } = pub(s);
    return { ...rest, rank: offset + i + 1, has_backing: !!backing_id };
  });
  return json({ songs, sort, offset, limit });
}

async function getSong(id, url){
  const r = await redis();
  const s = await r.hGetAll("song:" + id);
  if(!s.id || s.hidden === "1") return err(404, "Song not found");
  const perf = await files.getJSON(s.perf_key);
  if(!perf) return err(404, "Song data missing");
  const voter = url.searchParams.get("voter");
  const liked = !!(voter && VOTER_RE.test(voter) && await r.sIsMember("likes:" + id, voter));
  return json({ song: { ...pub(s), liked, backing_url: s.backing_id ? `/api/backing/${s.backing_id}` : null }, performance: perf });
}

async function publish(req){
  const b = await body(req);
  const voter = String(b.voter || ""), nickname = String(b.nickname || "").trim(), title = String(b.title || "").trim() || "Untitled jam";
  if(!VOTER_RE.test(voter)) return err(400, "Missing player id");
  if(!NICK_RE.test(nickname)) return err(400, "Nickname must be 2-20 letters or numbers");
  if(title.length > 40) return err(400, "Title is too long (40 max)");
  if(!clean(nickname) || !clean(title)) return err(400, "Please choose a different nickname or title");
  if(!MODES.includes(b.mode)) return err(400, "Bad mode");
  const perf = b.performance, bad = validatePerformance(perf);
  if(bad) return err(400, "Recording is not valid: " + bad);
  if(perf.events.filter(e => e.e === "note" || e.e === "chuck").length < 4) return err(400, "Play a few more strums before publishing");
  const r = await redis();
  let backingId = "", lyrics = "";
  if(b.mode === "song"){
    backingId = String(b.backingId || "");
    const job = /^[a-z0-9]{12}$/.test(backingId) ? await r.hGetAll("ai:" + backingId) : {};
    if(!job.id || job.voter !== voter) return err(400, "Make the AI song first");
    // claim it atomically so it can only be published once
    if(!(await r.hSetNX("ai:" + backingId, "used", "1"))) return err(400, "That AI song was already published");
    lyrics = job.lyrics || "";
  } else if(perf.backing) return err(400, "Only AI songs have a backing track");

  const ip = await ipHash(req);
  if(!(await take(r, "pub:" + ip, num(env.PUBLISH_PER_IP, 30)))) return err(429, "You've published a lot today — try again tomorrow");

  const id = rid(10), perf_key = `songs/${id}.json`;
  await files.put(perf_key, JSON.stringify(perf), "application/json");
  const s = { id, nickname, title, mode: b.mode, voice: perf.voice, bpm: perf.tempo?.bpm ? String(perf.tempo.bpm) : "",
    duration_ms: String(Math.round(perf.duration * 1000)), backing_id: backingId, lyrics, likes: "0", plays: "0", reports: "0",
    hidden: "0", voter, ip_hash: ip, created_at: String(now()), perf_key };
  await r.hSet("song:" + id, s);
  await index(r, s);
  return json({ id, url: `/song/${id}` }, 201);
}

async function act(req, id, what){
  const b = await body(req, 10_000), voter = String(b.voter || "");
  if(!VOTER_RE.test(voter)) return err(400, "Missing player id");
  const r = await redis();
  const s = await r.hGetAll("song:" + id);
  if(!s.id || s.hidden === "1") return err(404, "Song not found");
  const ip = await ipHash(req);
  if(what === "like"){
    if(!(await take(r, "like:" + ip, 300))) return err(429, "Too many likes today");
    const added = await r.sAdd("likes:" + id, voter);
    if(!added) await r.sRem("likes:" + id, voter);
    const likes = await r.hIncrBy("song:" + id, "likes", added ? 1 : -1);
    if(likes < 0) await r.hSet("song:" + id, "likes", "0");
    await index(r, { ...s, likes: Math.max(0, likes) });
    return json({ liked: !!added, likes: Math.max(0, likes) });
  }
  if(what === "play"){
    const k = `plays:${id}:${today()}`;
    const fresh = await r.sAdd(k, voter); if(fresh) await r.expire(k, 60*60*48);
    let plays = +s.plays;
    if(fresh && await take(r, "play:" + ip, 2000)){ plays = await r.hIncrBy("song:" + id, "plays", 1); await index(r, { ...s, plays }); }
    return json({ plays });
  }
  // report: different people -> hidden until checked
  if(await r.sAdd("reports:" + id, voter)){
    await r.hSet("song:" + id, "last_report", String(b.reason || "").slice(0, 200));
    const n = await r.hIncrBy("song:" + id, "reports", 1);
    if(n >= num(env.REPORTS_TO_HIDE, 3)){ await r.hSet("song:" + id, "hidden", "1"); await unindex(r, s); }
  }
  return json({ reported: true });
}

async function getBacking(id){
  const r = await redis();
  const key = await r.hGet("ai:" + id, "file");
  if(!key) return err(404, "Not found");
  const f = await files.get(key);
  if(!f) return err(404, "Not found");
  return new Response(f.body, { headers: { "content-type": f.type || "audio/mpeg", "cache-control": "public, max-age=31536000, immutable" } });
}

async function admin(req, id){
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if(!env.ADMIN_TOKEN || tok.length < 16 || tok !== env.ADMIN_TOKEN) return err(401, "No");
  const { action } = await body(req, 1000);
  const r = await redis();
  const s = await r.hGetAll("song:" + id);
  if(!s.id) return err(404, "Song not found");
  if(action === "hide"){ await r.hSet("song:" + id, "hidden", "1"); await unindex(r, s); }
  else if(action === "unhide"){ await r.hSet("song:" + id, "hidden", "0"); await index(r, s); }
  else if(action === "delete"){ await unindex(r, s); await r.del("song:" + id); await files.del(s.perf_key); }
  else return err(400, "action must be hide, unhide or delete");
  return json({ ok: true });
}

// ---------- Create a song ----------
async function makeBacking(req){
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

  const r = await redis();
  const ip = await ipHash(req);
  const okGlobal = await take(r, "ai:all", num(env.AI_DAILY_CAP, 40));
  const okIp = await take(r, "ai:" + ip, num(env.AI_PER_IP, 3));
  const okVoter = await take(r, "aiv:" + voter, num(env.AI_PER_IP, 3));
  const refund = () => Promise.all([give(r, "ai:all"), give(r, "ai:" + ip), give(r, "aiv:" + voter)]);
  if(!okGlobal || !okIp || !okVoter){
    await refund();
    return err(429, !okGlobal ? "The AI band is resting — lots of songs today. Try again tomorrow!" : "You've made your AI songs for today. Try again tomorrow!");
  }
  try {
    const out = await compose(env, { voice: b.voice, bpm, key, progression, durationMs, theme });
    const id = rid(12), file = `backing/${id}.${/wav/.test(out.type) ? "wav" : "mp3"}`;
    await files.put(file, out.audio, out.type);
    await r.hSet("ai:" + id, { id, voter, ip_hash: ip, file, lyrics: out.lyrics || "", bpm: String(bpm), duration_ms: String(durationMs), model: out.model, created_at: String(now()) });
    await r.expire("ai:" + id, 60*60*24*400);
    return json({ backingId: id, url: `/api/backing/${id}`, lyrics: out.lyrics || "", bpm, durationMs, model: out.model });
  } catch(e){
    await refund();
    console.error("elevenlabs", e.message);
    return err(502, e.userMessage || "The AI couldn't make this song. Try again in a minute.");
  }
}

// ---------- /song/:id with the song's own title for link previews ----------
let songHtml = null;
async function songPage(req, url, id){
  if(!songHtml) songHtml = await files.staticText("song.html", url);
  let s = null;
  try { const r = await redis(); s = await r.hGetAll("song:" + id); if(!s.id || s.hidden === "1") s = null; } catch(e){}
  const hdr = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=60" };
  if(!s) return new Response(songHtml, { status: 404, headers: hdr });
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
  const what = s.mode === "song" ? "an AI song built around a guitar played in the air" : "played in the air";
  const title = esc(`${s.title} by ${s.nickname} — AirKords`), desc = esc(`Listen to “${s.title}” by ${s.nickname}, ${what} on AirKords.`);
  const html = songHtml
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${desc}$2`);
  return new Response(html, { status: 200, headers: hdr });
}
