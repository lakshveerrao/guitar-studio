// /play — the AirKords guitar: remotes, setup, sounds, AI band, recording and publishing.
import { nav, footer, toast, fmtTime, esc } from "./common.js";
import { Motion, Calibrator, parsePacket, MOTION_DEFAULTS, tiltFromRaw } from "../core/motion.js";
import { AudioEngine, VOICES } from "../core/sound.js";
import { Band } from "../core/band.js";
import { Instrument, DEFAULT_MAP } from "../core/instrument.js";
import { Recorder } from "../core/performance.js";
import { Player } from "../core/player.js";
import { rough, enhance, createSong } from "../core/songmaker.js";
import { api } from "../core/api.js";
import { voicing, CHORDS } from "../core/chords.js";

nav("/play"); footer();
const $ = (id) => document.getElementById(id);
const SERVICE_UUID = "7a1d0001-3c5e-4b8a-9f2d-1a6b0c4e8f21", DATA_UUID = "7a1d0002-3c5e-4b8a-9f2d-1a6b0c4e8f21";
const NAMES = { fret: "AirKords Fret", strum: "AirKords Strum" };
const ROLES = ["fret", "strum"];
const MAX_REC = 180;

// ---------------- settings (kept on this device) ----------------
const SKEY = "airkords-play-v2";
const DEF = { motion: {}, map: DEFAULT_MAP, noPad: "mute", voice: "acoustic", vol: 0.8, bandVol: 0.7, tone: 0.6, nick: "" };
let S = structuredClone(DEF);
try { const saved = JSON.parse(localStorage.getItem(SKEY) || "null"); if(saved) S = { ...S, ...saved, map: { ...DEF.map, ...(saved.map || {}) } }; } catch(e){}
const save = () => { try { S.motion = pickMotion(motion.S); localStorage.setItem(SKEY, JSON.stringify(S)); } catch(e){} };
const MOTION_KEYS = Object.keys(MOTION_DEFAULTS);
const pickMotion = (m) => Object.fromEntries(MOTION_KEYS.map(k => [k, m[k]]));

// ---------------- engine (built on the first tap, as browsers require) ----------------
const motion = new Motion(S.motion);
const recorder = new Recorder();
let ctx = null, engine = null, band = null, inst = null, samplesReady = null;
let kbPads = 0, uiPads = 0, zoneOverride = null;

function ensureAudio(){
  if(!ctx){
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
    engine = new AudioEngine(ctx, { sampleBase: "/samples/" });
    engine.setVoice(S.voice, ctx.currentTime, true);
    engine.setVolume(S.vol); engine.setBandVolume(S.bandVol); engine.setTone(S.tone);
    band = new Band(engine, { bassRoot: () => inst.bassRoot(), onBeat: beatLight, onState: renderBand });
    inst = new Instrument(engine, { map: S.map, noPad: S.noPad, band, recorder });
    inst.attach(motion);
    const cb = motion.cb;
    motion.cb = {
      ...cb,
      onStrokeStart: (e) => { cb.onStrokeStart(e); showStroke(e.dir, e.vel); },
      onPads: () => syncPads(),
      onZone: () => syncZone(),
      onSlide: (dir, pos) => { inst.setPosition(pos); showSlide(dir); }
    };
    inst.onSound = (ev, t) => ringAt(ev, t);
    samplesReady = engine.load(["acoustic", "electric", "bass"]);
    syncPads(); syncZone(); inst.setPosition(motion.pos);
  }
  if(ctx.state !== "running") ctx.resume();
}
function syncPads(){ if(inst) inst.setPads(motion.pads() | kbPads | uiPads); }
function syncZone(){ if(inst) inst.setZone(zoneOverride ? { row: zoneOverride, col: "center" } : motion.zone); }

// ---------------- Bluetooth ----------------
const devs = { fret: null, strum: null }, rates = { fret: 0, strum: 0 };
let calib = null;
function setRemote(role, text, state){
  $("txt-" + role).textContent = text;
  const b = $("btn-" + role);
  ["ok","busy","bad"].forEach(c => b.classList.toggle(c, state === c));
}
async function connect(role){
  ensureAudio();
  if(!navigator.bluetooth){ $("warnBt").classList.add("show"); return; }
  const d = devs[role];
  if(d && d.gatt.connected){ d.gatt.disconnect(); return; }
  try{
    setRemote(role, "searching…", "busy");
    let dev = d;
    if(!dev){
      dev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: NAMES[role] }], optionalServices: [SERVICE_UUID] });
      const other = devs[role === "fret" ? "strum" : "fret"];
      if(other && other.id === dev.id){ setRemote(role, "that's the other remote!", "bad"); return; }
      devs[role] = dev;
      dev.addEventListener("gattserverdisconnected", () => { motion.disconnect(role); syncPads(); setRemote(role, "disconnected · tap to reconnect", "bad"); });
    }
    setRemote(role, "connecting…", "busy");
    const server = await dev.gatt.connect();
    const chr = await (await server.getPrimaryService(SERVICE_UUID)).getCharacteristic(DATA_UUID);
    chr.addEventListener("characteristicvaluechanged", (e) => onPacket(role, e.target.value));
    await chr.startNotifications();
    setRemote(role, "connected", "ok");
    if(!localStorage.getItem("airkords-setup-done")) setTimeout(() => openSetup(), 600);
  } catch(err){
    const cancelled = err && err.name === "NotFoundError";
    setRemote(role, cancelled ? (role === "fret" ? "left hand" : "right hand") + " · tap to connect" : "couldn't connect · tap to retry", cancelled ? null : "bad");
  }
}
function onPacket(role, dv){
  const p = parsePacket(dv); if(!p) return;
  rates[role]++;
  motion.feed(role, p, performance.now());
  if(calib) calib.add(role, p.raw);
}
ROLES.forEach(r => $("btn-" + r).addEventListener("click", () => connect(r)));
if(!navigator.bluetooth) $("warnBt").classList.add("show");
setInterval(() => {
  for(const r of ROLES){
    const d = motion.devs[r];
    if(d.have){
      let t = rates[r] ? rates[r] + " updates/s" : "no data";
      if(r === "fret") t += d.capOk ? " · pads ok" : " · no touch pads";
      if(!motion.devs[r === "fret" ? "strum" : "fret"].have) t += " · doing both";
      setRemote(r, t, rates[r] ? "ok" : "bad");
    }
    rates[r] = 0;
  }
}, 1000);

// ---------------- sound + band ----------------
function setVoice(v, fromUser){
  S.voice = v; save();
  document.body.dataset.voice = v;
  document.querySelectorAll("#voiceSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v));
  if(engine) engine.setVoice(v);
  renderBand();
}
$("voiceSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if(b){ ensureAudio(); setVoice(b.dataset.v, true); } });
$("btnBand").addEventListener("click", () => { ensureAudio(); band.setOn(!band.on); });
function renderBand(){
  const b = $("btnBand"), on = band && band.on;
  b.setAttribute("aria-pressed", !!on);
  const style = { acoustic: "pop", rock: "rock", metal: "metal" }[S.voice];
  $("bandTxt").textContent = !on ? "off · tap to jam" : band.state === "listening" ? "listening… strum steadily" : Math.round(band.bpm) + " BPM · " + style;
}
setInterval(() => { if(band && band.state === "playing") renderBand(); }, 600);
function beatLight(t, down){
  const ms = Math.max(0, (t - ctx.currentTime) * 1000);
  setTimeout(() => { const d = $("beat"); d.classList.remove("hit", "down"); void d.offsetWidth; d.classList.add("hit"); if(down) d.classList.add("down"); }, ms);
}

// ---------------- strings, pads, chord view ----------------
const neck = $("neck"), strEls = [];
for(let i=1;i<6;i++){ const f = document.createElement("div"); f.className = "fret"; f.style.left = (i*17) + "%"; neck.appendChild(f); }
for(let s=0; s<6; s++){ const el = document.createElement("div"); el.className = "str"; el.style.top = (12 + s*15.2) + "%"; el.style.height = (4 - s*0.5) + "px"; neck.appendChild(el); strEls.push(el); }
function ring(s){ const el = strEls[s]; if(!el) return; el.classList.remove("ring"); void el.offsetWidth; el.classList.add("ring"); }
function ringAt(ev, t){
  const ms = Math.max(0, (t - ctx.currentTime) * 1000);
  setTimeout(() => {
    if(ev.e === "note") ring(ev.s);
    else if(ev.e === "chuck") (S.voice === "acoustic" ? [0,1,2,3,4,5] : [0,1,2]).forEach(ring);
    flash();
  }, ms);
}
let flashT;
function flash(){ const c = $("chord"); c.classList.add("flash"); clearTimeout(flashT); flashT = setTimeout(() => c.classList.remove("flash"), 140); }
let arrowT;
function showStroke(dir, vel){
  const a = $("arrow"); a.textContent = dir > 0 ? "↓" : "↑"; a.classList.remove("hit"); void a.offsetWidth; a.classList.add("hit");
  clearTimeout(arrowT); arrowT = setTimeout(() => a.classList.remove("hit"), 150);
  $("strokeTxt").textContent = (dir > 0 ? "down" : "up") + " · " + Math.round(vel*100) + "%";
}
function showSlide(dir){ $("strokeTxt").textContent = dir > 0 ? "slid up the neck" : "slid down the neck"; }

// drag across strings
let lastY = null, lastT = 0, dragging = false;
const yOf = (e) => { const r = neck.getBoundingClientRect(); return (e.clientY - r.top) / r.height * 100; };
const lineOf = (s) => 12 + s*15.2 + 1;
neck.addEventListener("pointerdown", (e) => { ensureAudio(); dragging = true; neck.setPointerCapture(e.pointerId); lastY = yOf(e); lastT = performance.now(); });
neck.addEventListener("pointermove", (e) => {
  if(!dragging || !inst) return;
  const y = yOf(e), now = performance.now();
  const lo = Math.min(lastY, y), hi = Math.max(lastY, y);
  const crossed = [0,1,2,3,4,5].filter(s => lineOf(s) > lo && lineOf(s) <= hi);
  if(crossed.length){
    const dir = y > lastY ? 1 : -1, speed = Math.abs(y - lastY) / Math.max(4, now - lastT);
    const vel = Math.max(0.3, Math.min(1, 0.35 + speed*0.9));
    (dir > 0 ? crossed : crossed.reverse()).forEach(s => inst.pluck(s, dir, vel));
    showStroke(dir, vel);
  }
  lastY = y; lastT = now;
});
["pointerup","pointercancel"].forEach(ev => neck.addEventListener(ev, () => { dragging = false; lastY = null; }));

document.querySelectorAll(".pad").forEach(el => {
  const bit = 1 << +el.dataset.pad;
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); ensureAudio(); uiPads |= bit; syncPads(); });
  const off = () => { uiPads &= ~bit; syncPads(); };
  ["pointerup","pointerleave","pointercancel"].forEach(ev => el.addEventListener(ev, off));
});
document.querySelectorAll(".zone").forEach(el => {
  el.addEventListener("pointerdown", () => { ensureAudio(); zoneOverride = el.dataset.zone === "level" ? null : el.dataset.zone; if(el.dataset.zone === "level") zoneOverride = "level"; syncZone(); });
  const off = () => { if(zoneOverride){ zoneOverride = null; syncZone(); } };
  ["pointerup","pointerleave","pointercancel"].forEach(ev => el.addEventListener(ev, off));
});

// keyboard
const PADKEYS = { "1": 1, "2": 2, "3": 4 };
addEventListener("keydown", (e) => {
  if(e.target.closest("input,select,textarea,dialog[open]")) return;
  const k = e.key.toLowerCase();
  if(PADKEYS[k]){ ensureAudio(); kbPads |= PADKEYS[k]; syncPads(); return; }
  if(e.repeat){ if([" ","arrowup","arrowdown","arrowleft","arrowright"].includes(k)) e.preventDefault(); return; }
  if(k === "arrowup" || k === "arrowdown"){ e.preventDefault(); ensureAudio(); zoneOverride = k === "arrowup" ? "up" : "down"; syncZone(); }
  else if(k === "arrowleft" || k === "arrowright"){
    e.preventDefault(); ensureAudio();
    const dir = k === "arrowright" ? 1 : -1, np = Math.max(0, Math.min(motion.S.slideMax, motion.pos + dir*motion.S.slideStep));
    if(np !== motion.pos){ motion.setPosition(np); inst.setPosition(np); showSlide(dir); }
  }
  else if(k === " "){ e.preventDefault(); ensureAudio(); inst.strum(1, e.shiftKey ? 0.6 : 0.8, e.shiftKey ? 2 : 6); showStroke(1, 0.8); }
  else if(k === "f"){ ensureAudio(); inst.strum(1, 0.6, 2); showStroke(1, 0.6); }
  else if(k === "u"){ ensureAudio(); inst.strum(-1, 0.65, 6); showStroke(-1, 0.65); }
  else if(k === "v"){ ensureAudio(); setVoice(VOICES[(VOICES.indexOf(S.voice)+1) % 3], true); }
  else if(k === "b"){ ensureAudio(); band.setOn(!band.on); }
  else if(k === "r"){ toggleRec(); }
});
addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if(PADKEYS[k]){ kbPads &= ~PADKEYS[k]; syncPads(); }
  if((k === "arrowup" || k === "arrowdown") && zoneOverride){ zoneOverride = null; syncZone(); }
});
addEventListener("blur", () => { kbPads = 0; uiPads = 0; zoneOverride = null; syncPads(); syncZone(); });

// chord diagram
function diagram(shape){
  if(!shape) return "";
  const played = shape.filter(v => v !== null && v > 0), max = Math.max(0, ...played), min = played.length ? Math.min(...played) : 1;
  const start = max > 4 ? min : 1, x0 = 15, dx = 16, y0 = 24, dy = 24;
  let s = start === 1 ? `<rect x="${x0-1}" y="${y0-3}" width="${dx*5+2}" height="4" fill="#cfc6bc"/>` : `<text x="${x0-8}" y="${y0+dy/2+4}" text-anchor="end" fill="#b3a698" font-size="10" font-family="monospace">${start}</text>`;
  for(let r=0;r<=4;r++) s += `<line x1="${x0}" y1="${y0+r*dy}" x2="${x0+dx*5}" y2="${y0+r*dy}" stroke="#4a4038" stroke-width="1.5"/>`;
  for(let i=0;i<6;i++) s += `<line x1="${x0+i*dx}" y1="${y0}" x2="${x0+i*dx}" y2="${y0+4*dy}" stroke="#7d7166" stroke-width="${1+(5-i)*0.25}"/>`;
  shape.forEach((v, i) => {
    const x = x0 + i*dx;
    if(v === null) s += `<text x="${x}" y="${y0-8}" text-anchor="middle" fill="#7d7166" font-size="11" font-family="monospace">×</text>`;
    else if(v === 0) s += `<circle cx="${x}" cy="${y0-11}" r="4" fill="none" stroke="#b3a698" stroke-width="1.5"/>`;
    else if(v - start < 4) s += `<circle cx="${x}" cy="${y0+(v-start+0.5)*dy}" r="6.5" fill="var(--brand)"/>`;
  });
  return s;
}
// position indicator
const posNeck = $("posNeck");
for(let i=0;i<=6;i++){ posNeck.appendChild(document.createElement("i")); }

let lastKey = "";
function frame(){
  const voice = S.voice, pos = inst ? inst.pos : motion.pos;
  const pads = inst ? inst.pads : (kbPads | uiPads), zone = inst ? inst.zone : { row: "level", col: "center" };
  const bank = S.map[zone.col] || S.map.center;
  const cur = inst ? inst.current() : null;
  const key = [voice, pos, pads, zone.row, zone.col, cur && cur.label, S.noPad].join("|");
  if(key !== lastKey){
    lastKey = key;
    document.querySelectorAll(".pad").forEach((el, i) => {
      el.classList.toggle("on", !!(pads & (1 << i)));
      el.querySelector(".c").textContent = voicing(bank[zone.row][i], voice, pos)?.label || "–";
    });
    for(const r of ["up","level","down"]){
      $("z-" + r).textContent = bank[r].map(n => voicing(n, voice, pos)?.label).join(" · ");
      document.querySelector(`.zone[data-zone=${r}]`).classList.toggle("on", zone.row === r);
    }
    const c = $("chord");
    c.textContent = cur ? cur.label : (voice === "acoustic" ? "mute" : "chug");
    c.classList.toggle("muted", !cur);
    $("diagram").innerHTML = cur ? diagram(cur.shape) : "";
    strEls.forEach((el, s) => el.classList.toggle("off", !cur || cur.notes[s] === null));
    const step = motion.S.slideStep;
    [...posNeck.children].forEach((el, i) => el.classList.toggle("on", Math.round(pos/step) === i));
    $("posTxt").textContent = pos ? `+${pos} frets` : "Open";
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- recording ----------------
let recT0 = 0, recTimer = null, takePerf = null;
function toggleRec(){
  ensureAudio();
  const btn = $("btnRec");
  if(!recorder.on){
    recorder.start(ctx.currentTime, engine.voice);
    recT0 = performance.now();
    btn.setAttribute("aria-pressed", "true"); btn.setAttribute("aria-label", "Stop recording");
    $("recTitle").textContent = "Recording…"; $("recSub").textContent = "Play your song. Press stop when you're done.";
    recTimer = setInterval(() => {
      const s = (performance.now() - recT0)/1000;
      $("recTime").textContent = fmtTime(s);
      if(s >= MAX_REC){ toggleRec(); toast("That's 3 minutes — recording stopped."); }
    }, 200);
  } else {
    clearInterval(recTimer);
    const perf = recorder.stop(ctx.currentTime);
    btn.setAttribute("aria-pressed", "false"); btn.setAttribute("aria-label", "Record");
    $("recTitle").textContent = "Record a song"; $("recSub").textContent = "Press record, play, then press stop. Up to 3 minutes.";
    $("recTime").textContent = "0:00";
    const sounds = perf.events.filter(e => e.e === "note" || e.e === "chuck").length;
    if(sounds < 4){ toast("That was very short — play a few more strums and try again.", true); return; }
    takePerf = perf; openPublish();
  }
}
$("btnRec").addEventListener("click", toggleRec);

// ---------------- publish ----------------
const dlgPub = $("dlgPub");
let versions = {}, mode = "enhanced", ai = null, preview = null, previewing = null;
const PLAY_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.6-6.5z"/></svg>`, STOP_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
function openPublish(){
  versions = { rough: rough(takePerf), enhanced: enhance(takePerf) };
  ai = null; $("aiResult").style.display = "none"; $("aiSteps").innerHTML = ""; $("btnMake").disabled = false; $("btnMake").textContent = "✦ Make my AI song";
  $("pubLen").textContent = fmtTime(takePerf.duration);
  $("nick").value = S.nick || ""; $("title").value = "";
  $("pubChoose").style.display = ""; $("pubDone").style.display = "none";
  setMode("enhanced");
  document.querySelectorAll("[data-listen]").forEach(b => { b.innerHTML = PLAY_ICON; b.classList.remove("on"); });
  dlgPub.showModal();
}
function setMode(m){
  mode = m;
  document.querySelectorAll(".opt").forEach(o => o.setAttribute("aria-pressed", o.dataset.mode === m));
  $("aiBox").style.display = m === "song" ? "" : "none";
  $("btnPublish").disabled = m === "song" && !ai;
}
document.querySelectorAll(".opt").forEach(o => {
  o.addEventListener("click", (e) => { if(!e.target.closest("[data-listen]")) setMode(o.dataset.mode); });
  o.addEventListener("keydown", (e) => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); setMode(o.dataset.mode); } });
});
function stopPreview(){
  if(preview){ preview.stop(); preview = null; }
  previewing = null;
  document.querySelectorAll("[data-listen]").forEach(b => { b.innerHTML = PLAY_ICON; b.classList.remove("on"); });
  if(engine){ engine.setVoice(S.voice, ctx.currentTime, true); engine.setStudio(false); }
}
document.querySelectorAll("[data-listen]").forEach(b => { b.innerHTML = PLAY_ICON; b.addEventListener("click", async (e) => {
  e.stopPropagation(); ensureAudio();
  const which = b.dataset.listen; const was = previewing === which; stopPreview(); if(was) return;
  await samplesReady;
  previewing = which; b.innerHTML = STOP_ICON; b.classList.add("on");
  preview = new Player(engine, { onEnd: stopPreview });
  if(which === "song") await preview.play(ai.performance, { backing: ai.backing });
  else await preview.play(versions[which]);
}); });
$("btnMake").addEventListener("click", async () => {
  ensureAudio(); stopPreview();
  const btn = $("btnMake"); btn.disabled = true; btn.textContent = "Making your song…";
  const steps = $("aiSteps"); steps.innerHTML = "";
  const add = (t) => { steps.querySelectorAll(".now").forEach(x => { x.classList.remove("now"); x.classList.add("done"); }); const d = document.createElement("div"); d.className = "now"; d.textContent = t; steps.appendChild(d); };
  try{
    ai = await createSong(takePerf, { ctx, theme: $("theme").value.trim(), onStep: add });
    add("Done!"); steps.lastChild.className = "done";
    $("lyrics").textContent = ai.lyrics || "(no lyrics came back for this one)";
    $("aiResult").style.display = ""; btn.textContent = "↻ Make a different one"; btn.disabled = false;
    setMode("song");
  } catch(err){
    steps.querySelectorAll(".now").forEach(x => x.remove());
    toast(err.message || "The AI couldn't make this song.", true);
    btn.textContent = "✦ Try again"; btn.disabled = false;
  }
});
$("btnPublish").addEventListener("click", async () => {
  const nickname = $("nick").value.trim(), title = $("title").value.trim() || "My jam";
  if(nickname.length < 2){ $("nick").focus(); toast("Pick a nickname first (2–20 letters).", true); return; }
  stopPreview();
  const btn = $("btnPublish"); btn.disabled = true; btn.textContent = "Publishing…";
  try{
    const performance = mode === "song" ? ai.performance : versions[mode];
    const r = await api.publish({ nickname, title, mode, performance, backingId: mode === "song" ? ai.backingId : undefined });
    S.nick = nickname; save();
    const url = location.origin + r.url;
    $("shareUrl").value = url; $("lnkSong").href = r.url;
    $("pubChoose").style.display = "none"; $("pubDone").style.display = "";
  } catch(err){ toast(err.message, true); }
  btn.disabled = false; btn.textContent = "Publish to the charts";
});
$("btnCopy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("shareUrl").value); toast("Link copied!"); } catch(e){ $("shareUrl").select(); } });
document.querySelectorAll("dialog").forEach(d => {
  d.addEventListener("click", (e) => { if(e.target === d || e.target.closest("[data-close]")) d.close(); });
  d.addEventListener("close", () => { stopPreview(); if(d.id === "dlgSetup") stopWizard(); });
});

// ---------------- setup wizard ----------------
const dlgSetup = $("dlgSetup");
const STEP_TEXT = {
  still: ["Hold both remotes still, the way you normally hold them.", 2000],
  strum: ["Now strum with the <b>strum remote</b> — big swings, a few times.", 3500],
  tilt:  ["Tilt the <b>fret remote's</b> neck <b>up</b> and hold it there.", 2500],
  slide: ["Slide the <b>fret remote</b> along the neck towards the guitar body — three quick slides.", 4000]
};
let wz = null;
function openSetup(){ ensureAudio(); renderWizardIdle(); dlgSetup.showModal(); }
function renderWizardIdle(){
  const any = motion.devs.fret.have || motion.devs.strum.have;
  $("wzStep").innerHTML = any ? "Press start and follow each step." : "Connect at least one remote first.";
  $("btnWz").disabled = !any; $("btnLevel").disabled = !any; $("wzBar").style.width = "0%"; $("wzDots").innerHTML = "";
}
$("btnSetup").addEventListener("click", openSetup);
$("btnWz").addEventListener("click", () => {
  const steps = ["still", "strum", "tilt"]; if(motion.bothConnected()) steps.push("slide");
  calib = new Calibrator(motion);
  wz = { steps, i: 0, t0: performance.now(), notes: [] };
  $("wzDots").innerHTML = steps.map(() => "<i></i>").join("");
  $("btnWz").disabled = true;
  runStep();
});
function runStep(){
  if(!wz) return;
  const name = wz.steps[wz.i], [text, ms] = STEP_TEXT[name];
  $("wzStep").innerHTML = text; calib.reset(); wz.t0 = performance.now(); wz.ms = ms;
  [...$("wzDots").children].forEach((d, k) => d.classList.toggle("on", k <= wz.i));
  const tick = () => {
    if(!wz) return;
    const p = (performance.now() - wz.t0) / wz.ms;
    $("wzBar").style.width = Math.min(100, p*100) + "%";
    if(p < 1){ requestAnimationFrame(tick); return; }
    const r = calib.finish(name);
    if(!r.ok) wz.notes.push(name);
    wz.i++;
    if(wz.i < wz.steps.length) runStep(); else finishWizard();
  };
  requestAnimationFrame(tick);
}
function finishWizard(){
  const failed = wz.notes; wz = null; calib = null; save();
  try { localStorage.setItem("airkords-setup-done", "1"); } catch(e){}
  $("wzBar").style.width = "100%"; $("btnWz").disabled = false; $("btnWz").textContent = "Run again";
  if(!failed.length){ $("wzStep").innerHTML = "<b>All set!</b> Hold a pad and strum."; setTimeout(() => dlgSetup.open && dlgSetup.close(), 1400); }
  else $("wzStep").innerHTML = "Almost — I didn't catch the " + failed.map(f => ({ tilt: "tilt", slide: "slide", strum: "strum" }[f] || f)).join(" and ") + ". Run it again and move a bit bigger.";
  motion.zone = { row: "level", col: "center" }; syncZone();
}
function stopWizard(){ wz = null; calib = null; $("btnWz").disabled = false; }
$("btnLevel").addEventListener("click", () => {
  for(const r of ROLES){ const d = motion.devs[r]; if(!d.have) continue;
    motion.S.base[r] = [0,1,2].map(ax => tiltFromRaw(d.raw, ax)); motion.S.bias[r] = [d.raw[3], d.raw[4], d.raw[5]]; }
  motion.zone = { row: "level", col: "center" }; syncZone(); save(); toast("Level set.");
});

// ---------------- settings ----------------
const dlgSet = $("dlgSettings");
$("btnSettings").addEventListener("click", () => { ensureAudio(); buildSettings(); dlgSet.showModal(); });
function slider(id, label, min, max, step, get, set, fmt){
  return { html: `<div class="set__row"><label for="${id}">${label}</label><div class="ctl"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${get()}"><output id="${id}-o">${fmt(get())}</output></div></div>`,
    bind(){ const el = $(id); el.addEventListener("input", () => { set(+el.value); $(id + "-o").textContent = fmt(+el.value); save(); }); } };
}
function toggle(id, label, get, set){
  return { html: `<div class="set__row"><label for="${id}">${label}</label><div class="ctl"><input type="checkbox" id="${id}" ${get() ? "checked" : ""} style="width:22px;height:22px;accent-color:var(--brand)"></div></div>`,
    bind(){ $(id).addEventListener("change", (e) => { set(e.target.checked); save(); if(id === "s-twist") buildSettings(); }); } };
}
function select(id, label, opts, get, set){
  return { html: `<div class="set__row"><label for="${id}">${label}</label><div class="ctl"><select id="${id}">${opts.map(([v,t]) => `<option value="${v}" ${String(get()) === String(v) ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>`,
    bind(){ $(id).addEventListener("change", (e) => { set(e.target.value); save(); }); } };
}
function buildSettings(){
  const M = motion.S;
  const items = [
    { html: "<h3>Strumming</h3>" },
    slider("s-thr", "Strum sensitivity", 60, 400, 10, () => M.strumThr, v => M.strumThr = v, v => v < 120 ? "very light" : v < 200 ? "normal" : "firm"),
    slider("s-full", "Swing size for all 6 strings", 30, 120, 5, () => M.fullStrumDeg, v => M.fullStrumDeg = v, v => v + "°"),
    toggle("s-pick", "Pick mode (hand height picks the string)", () => M.pickMode, v => M.pickMode = v),
    { html: "<h3>Neck</h3>" },
    slider("s-tilt", "Tilt needed to change row", 10, 50, 1, () => M.tiltAng, v => M.tiltAng = v, v => v + "°"),
    toggle("s-slide", "Slide along the neck", () => M.slide, v => M.slide = v),
    slider("s-sthr", "Slide sensitivity", 0.25, 1.2, 0.05, () => M.slideThr, v => M.slideThr = v, v => v < 0.45 ? "light" : v < 0.75 ? "normal" : "firm"),
    select("s-step", "Each slide moves", [[1,"1 fret"],[2,"2 frets"]], () => M.slideStep, v => M.slideStep = +v),
    toggle("s-twist", "Wrist twist for 2 more chord banks", () => M.twist, v => M.twist = v),
    select("s-nopad", "Strum with no pad held", [["mute","Muted strum"],["open","Open strings"],["last","Last chord"]], () => S.noPad, v => { S.noPad = v; if(inst) inst.noPad = v; }),
    { html: "<h3>Sound</h3>" },
    slider("s-vol", "Volume", 0, 1, 0.01, () => S.vol, v => { S.vol = v; engine.setVolume(v); }, v => Math.round(v*100) + "%"),
    slider("s-bvol", "Band volume", 0, 1, 0.01, () => S.bandVol, v => { S.bandVol = v; engine.setBandVolume(v); }, v => Math.round(v*100) + "%"),
    slider("s-tone", "Tone", 0, 1, 0.01, () => S.tone, v => { S.tone = v; engine.setTone(v); }, v => v < .35 ? "warm" : v < .7 ? "natural" : "bright"),
    { html: "<h3>Chords</h3>" + mapTable(M.twist) },
    { html: `<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap"><button class="btn btn--line btn--sm" id="s-reset">Reset everything</button></div>` }
  ];
  $("settings").innerHTML = items.map(i => i.html).join("");
  items.forEach(i => i.bind && i.bind());
  $("settings").querySelectorAll("select[data-b]").forEach(sel => sel.addEventListener("change", () => {
    S.map[sel.dataset.b][sel.dataset.r][+sel.dataset.p] = sel.value; if(inst) inst.map = S.map; lastKey = ""; save();
  }));
  $("s-reset").addEventListener("click", () => {
    if(!confirm("Reset all settings and setup?")) return;
    try { localStorage.removeItem(SKEY); localStorage.removeItem("airkords-setup-done"); } catch(e){}
    location.reload();
  });
}
function mapTable(twist){
  const banks = twist ? [["left","Twist left"],["center","Centre"],["right","Twist right"]] : [["center",""]];
  const names = Object.keys(CHORDS);
  return banks.map(([b, t]) => `${t ? `<div class="faint" style="font-size:13px;margin-top:8px">${t}</div>` : ""}<table class="map"><tr><th></th><th>Pad 1</th><th>Pad 2</th><th>Pad 3</th></tr>` +
    ["up","level","down"].map(r => `<tr><th>${{ up: "Tilt up", level: "Level", down: "Tilt down" }[r]}</th>` + [0,1,2].map(p =>
      `<td><select data-b="${b}" data-r="${r}" data-p="${p}" aria-label="${b} ${r} pad ${p+1}">${names.map(n => `<option ${n === S.map[b][r][p] ? "selected" : ""}>${n}</option>`).join("")}</select></td>`).join("") + "</tr>").join("") + "</table>").join("");
}

// first tap anywhere unlocks sound (browser rule)
addEventListener("pointerdown", () => ensureAudio(), { once: true });
setVoice(S.voice);
if(location.hash === "#record") setTimeout(() => $("record").scrollIntoView({ behavior: "smooth", block: "center" }), 300);

// test hook
window.__ak = { motion, get inst(){ return inst; }, get engine(){ return engine; }, get band(){ return band; }, recorder, ensureAudio, onPacket, toggleRec, get takePerf(){ return takePerf; } };
