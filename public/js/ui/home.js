import { nav, footer, reveal, songRow, esc, toast } from "./common.js";
import { AudioEngine } from "../core/sound.js";
import { voicing } from "../core/chords.js";
import { api } from "../core/api.js";
import * as listen from "./listen.js";

nav("/"); footer(); reveal();
// if a photo is missing, hide its frame instead of showing a broken image
function noImg(img){ const p = img.parentElement; img.remove(); if(p && p.classList.contains("hero__photo")) p.classList.add("noimg"); else if(p) p.style.display = "none"; }
document.querySelectorAll("img").forEach(img => { if(img.complete && !img.naturalWidth) noImg(img); else img.addEventListener("error", () => noImg(img)); });

// ---------- one engine for the demos ----------
let ctx, engine, loaded = null;
async function audio(){
  if(!ctx){ ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" }); engine = new AudioEngine(ctx, { sampleBase: "/samples/" }); }
  if(ctx.state !== "running") await ctx.resume();
  if(!loaded) loaded = engine.load(["acoustic", "electric"]);
  return engine;
}

// ---------- try it: drag across the strings ----------
const CHORDS = ["G","C","D","Em","Am"];
let chord = "G", voice = "acoustic";
const neck = document.getElementById("neck"), pick = document.getElementById("pick"), nameEl = document.getElementById("neckName");
const chips = document.getElementById("tryChords");
chips.innerHTML = CHORDS.map(c => `<button class="chip" aria-pressed="${c===chord}" data-c="${c}">${c}</button>`).join("");
chips.addEventListener("click", e => { const b = e.target.closest("[data-c]"); if(!b) return; chord = b.dataset.c; chips.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === b)); paintStrings(); audio(); });
document.getElementById("tryVoice").addEventListener("click", async e => {
  const b = e.target.closest("[data-v]"); if(!b) return; voice = b.dataset.v;
  document.querySelectorAll("#tryVoice button").forEach(x => x.setAttribute("aria-pressed", x === b));
  const E = await audio(); E.setVoice(voice); paintStrings();
});
// frets + strings
for(let i=1;i<6;i++){ const f = document.createElement("div"); f.className = "fret"; f.style.left = (i*17) + "%"; neck.appendChild(f); }
[25.5, 59.5].forEach(x => { const d = document.createElement("div"); d.className = "inlay"; d.style.left = x + "%"; neck.appendChild(d); });
const strs = [];
for(let s=0; s<6; s++){        // string 0 = low E at the top, like looking down at a guitar you hold
  const el = document.createElement("div"); el.className = "str";
  el.style.top = (14 + s*14.4) + "%"; el.style.height = (4.2 - s*0.55) + "px";
  neck.appendChild(el); strs.push(el);
}
function current(){ return voicing(chord, voice); }
function paintStrings(){ const v = current(); nameEl.textContent = v.label; strs.forEach((el,s) => el.classList.toggle("off", v.notes[s] === null)); }
paintStrings();
function ringEl(s){ const el = strs[s]; el.classList.remove("ring"); void el.offsetWidth; el.classList.add("ring"); }
let lastY = null, lastT = 0, active = false;
const yOf = (e) => { const r = neck.getBoundingClientRect(); return (e.clientY - r.top) / r.height * 100; };
const lineOf = (s) => 14 + s*14.4 + 1;
neck.addEventListener("pointerdown", async e => { active = true; neck.setPointerCapture(e.pointerId); lastY = yOf(e); lastT = performance.now(); movePick(e); await audio(); });
neck.addEventListener("pointermove", e => {
  movePick(e);
  if(!active || !engine) return;
  const y = yOf(e), now = performance.now();
  if(lastY === null){ lastY = y; lastT = now; return; }
  const lo = Math.min(lastY, y), hi = Math.max(lastY, y);
  const crossed = [0,1,2,3,4,5].filter(s => lineOf(s) > lo && lineOf(s) <= hi);
  if(crossed.length){
    const speed = Math.abs(y - lastY) / Math.max(4, now - lastT);   // % per ms
    const vel = Math.max(0.3, Math.min(1, 0.35 + speed*0.9));
    const order = y > lastY ? crossed : crossed.reverse();
    const v = current();
    order.forEach((s, k) => { if(v.notes[s] === null) return; engine.note(s, v.notes[s], ctx.currentTime + 0.002 + k*0.004, vel); ringEl(s); });
  }
  lastY = y; lastT = now;
});
const end = () => { active = false; lastY = null; pick.style.opacity = 0; };
neck.addEventListener("pointerup", end); neck.addEventListener("pointercancel", end); neck.addEventListener("pointerleave", () => { if(!active) pick.style.opacity = 0; });
function movePick(e){ const r = neck.getBoundingClientRect(); pick.style.left = (e.clientX - r.left) + "px"; pick.style.top = (e.clientY - r.top) + "px"; pick.style.opacity = 1; }

// ---------- three sounds: a short riff each ----------
let riffTimer = null, riffCard = null;
function stopRiff(){ clearTimeout(riffTimer); if(riffCard){ riffCard.classList.remove("playing"); const b = riffCard.querySelector(".btn"); b.classList.remove("on"); b.textContent = "▶ Hear it"; } riffCard = null; if(engine) for(let s=0;s<6;s++) engine.damp(s); }
document.querySelectorAll(".voice").forEach(card => card.querySelector(".btn").addEventListener("click", async () => {
  const was = riffCard === card; stopRiff(); if(was) return;
  const E = await audio(); await loaded;
  const v = card.dataset.voice; E.setVoice(v);
  riffCard = card; card.classList.add("playing"); const b = card.querySelector(".btn"); b.classList.add("on"); b.textContent = "■ Stop";
  const prog = v === "metal" ? ["E","E","G","A"] : v === "rock" ? ["A","D","E","D"] : ["G","C","D","G"];
  const bpm = v === "metal" ? 150 : v === "rock" ? 128 : 100, e8 = 30/bpm;
  // pattern per bar (8ths): acoustic D DU UDU, rock all downs, metal chugs + accents
  const pat = v === "acoustic" ? [1,0,1,-1,0,-1,1,-1] : v === "rock" ? [1,1,1,1,1,1,1,1] : ["c","c",1,"c","c",1,"c",1];
  let t0 = ctx.currentTime + 0.08;
  prog.forEach((name, bar) => pat.forEach((p, i) => {
    const t = t0 + (bar*8 + i)*e8; if(!p) return;
    if(p === "c"){ E.chuck(1, 0.9, t); return; }
    const notes = voicing(name, v).notes, live = [0,1,2,3,4,5].filter(s => notes[s] !== null);
    const order = p > 0 ? live : [...live].reverse().slice(0, 4);
    order.forEach((s, k) => E.note(s, notes[s], t + k*(v === "metal" ? 0.004 : 0.011), p > 0 ? 0.8 : 0.55));
  }));
  riffTimer = setTimeout(stopRiff, (prog.length*8*e8 + 1.8)*1000);
}));

// ---------- top songs ----------
const box = document.getElementById("topSongs");
api.list({ sort: "top", limit: 5 }).then(({ songs }) => {
  if(!songs.length){ box.innerHTML = `<div class="empty">No songs yet — <a href="/play" style="color:var(--brand);text-decoration:underline">be the first on the charts</a>.</div>`; return; }
  const liked = listen.likedSet();
  box.innerHTML = songs.map(s => songRow(s, { rank: s.rank })).join("");
  box.querySelectorAll(".row").forEach(r => r.querySelector(".like").setAttribute("aria-pressed", liked.has(r.dataset.id)));
}).catch(() => { box.innerHTML = `<div class="empty">The charts couldn't load right now.</div>`; });
box.addEventListener("click", async e => {
  const row = e.target.closest(".row"); if(!row) return;
  if(e.target.closest(".row__play")){ stopRiff(); await listen.toggle(row.dataset.id); }
  else if(e.target.closest(".like")){
    const b = e.target.closest(".like");
    try { const r = await listen.like(row.dataset.id); b.setAttribute("aria-pressed", r.liked); b.querySelector("span").textContent = r.likes; } catch(err){ toast(err.message, true); }
  }
});
listen.onChange(cur => box.querySelectorAll(".row").forEach(r => {
  const on = cur && cur.id === r.dataset.id, b = r.querySelector(".row__play");
  b.classList.toggle("playing", !!on);
  b.innerHTML = on ? `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>` : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>`;
}));
