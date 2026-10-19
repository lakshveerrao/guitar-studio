import { nav, footer, esc, toast, fmtTime, ago, ICON, MODE_LABEL, VOICE_LABEL } from "./common.js";
import * as listen from "./listen.js";

nav("/songs"); footer();
const id = (location.pathname.match(/\/song\/([a-z0-9]{10})/) || [])[1] || new URLSearchParams(location.search).get("id");
const main = document.getElementById("main");

const MODE_TEXT = {
  rough: "Published exactly as it was played.",
  enhanced: "The player's own strums, tightened to the beat with a studio sound.",
  song: "The guitar is exactly as played. The singer, drums and bass were added by AI."
};

async function init(){
  if(!id){ main.innerHTML = `<div class="empty">Song not found. <a href="/songs" style="color:var(--brand)">See all songs</a></div>`; return; }
  let d;
  try { d = await listen.load(id); }
  catch(e){ main.innerHTML = `<div class="empty">${e.status === 404 ? "This song isn't available." : "The song couldn't load."} <a href="/songs" style="color:var(--brand);text-decoration:underline">See all songs</a></div>`; return; }
  const s = d.song, p = d.performance;
  document.title = `${s.title} by ${s.nickname} — AirKords`;
  document.body.dataset.voice = s.voice;
  const chords = [...new Set(p.events.filter(e => e.e === "chord").map(e => e.label))];
  main.innerHTML = `
    <a href="/songs" class="dim" style="font-size:14px">← All songs</a>
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><span class="badge badge--${esc(s.mode)}">${MODE_LABEL[s.mode]}</span><span class="badge badge--${esc(s.voice)}">${VOICE_LABEL[s.voice]}</span></div>
    <h1 class="section-h" style="font-size:clamp(2.4rem,6vw,4rem);margin-top:12px">${esc(s.title)}</h1>
    <p class="dim" style="margin:10px 0 0;font-size:17px">by <b style="color:var(--text)">${esc(s.nickname)}</b> · ${ago(s.created_at)}</p>
    <div class="player">
      <div class="card deck">
        <div class="deck__top">
          <button class="bigplay" id="play" aria-label="Play">${ICON.play}</button>
          <div><div class="chordnow" id="chordNow">${esc(chords[0] || "♪")}</div><div class="faint" style="font-size:13px;margin-top:6px">now playing chord</div></div>
        </div>
        <div class="strings" id="strings">${"<i></i>".repeat(6)}</div>
        <div><div class="prog" id="prog"><div id="bar"></div></div><div class="times" style="margin-top:6px"><span id="tnow">0:00</span><span>${fmtTime(p.duration)}</span></div></div>
        <div class="actions">
          <button class="like" id="like" aria-pressed="${!!s.liked}">${ICON.heart}<span>${s.likes}</span></button>
          <button class="btn btn--line btn--sm" id="share">Share</button>
          <a class="btn btn--brand btn--sm" href="/play#record">Make your own</a>
        </div>
      </div>
      <div class="card side">
        ${s.lyrics ? `<div class="eyebrow eyebrow--brand">Lyrics</div><div class="lyrics">${esc(s.lyrics)}</div>` : `<div class="eyebrow eyebrow--brand">About this song</div>`}
        <p class="dim" style="margin:0">${MODE_TEXT[s.mode]}</p>
        <div class="facts">
          <div class="fact"><span>Plays</span><b id="plays">${s.plays}</b></div>
          <div class="fact"><span>Tempo</span><b>${s.bpm ? Math.round(s.bpm) + " BPM" : "free time"}</b></div>
          <div class="fact" style="grid-column:1/-1"><span>Chords</span><b>${esc(chords.slice(0, 10).join(" · ") || "—")}</b></div>
        </div>
        <button class="report" id="report">Report this song</button>
      </div>
    </div>`;

  const $ = (x) => document.getElementById(x);
  const strs = [...$("strings").children];
  const onEvent = (e) => {
    if(e.e === "chord"){ const c = $("chordNow"); c.textContent = e.label; }
    if(e.e === "note"){ const el = strs[e.s]; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 90); const c = $("chordNow"); c.classList.add("flash"); setTimeout(() => c.classList.remove("flash"), 120); }
  };
  $("play").addEventListener("click", () => listen.toggle(id, { onEvent }));
  listen.onChange(cur => {
    const on = cur && cur.id === id;
    $("play").innerHTML = on ? (cur.loading ? "…" : ICON.pause) : ICON.play;
    if(!on){ $("bar").style.width = "0%"; $("tnow").textContent = "0:00"; }
  });
  (function tick(){
    const cur = listen.nowPlaying();
    if(cur && cur.id === id && cur.duration){ const t = listen.position(); $("bar").style.width = Math.min(100, t/cur.duration*100) + "%"; $("tnow").textContent = fmtTime(t); }
    requestAnimationFrame(tick);
  })();
  $("like").addEventListener("click", async () => {
    try { const r = await listen.like(id); $("like").setAttribute("aria-pressed", r.liked); $("like").querySelector("span").textContent = r.likes; } catch(e){ toast(e.message, true); }
  });
  $("share").addEventListener("click", async () => {
    const url = location.origin + "/song/" + id;
    try { if(navigator.share) await navigator.share({ title: s.title, text: `${s.title} by ${s.nickname} — played in the air on AirKords`, url }); else { await navigator.clipboard.writeText(url); toast("Link copied!"); } } catch(e){}
  });
  $("report").addEventListener("click", async () => {
    const reason = prompt("What's wrong with this song? (e.g. rude title)"); if(reason === null) return;
    try { const { api } = await import("../core/api.js"); await api.report(id, reason); toast("Thanks — we'll take a look."); $("report").disabled = true; $("report").textContent = "Reported"; } catch(e){ toast(e.message, true); }
  });
}
init();
