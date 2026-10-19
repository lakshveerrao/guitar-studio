// A recorded performance = everything needed to play a song back exactly.
//
// perf = {
//   v: 1, voice: "acoustic"|"rock"|"metal", duration: seconds, studio: bool,
//   events: [ sorted by t (seconds from start)
//     {t, e:"stroke", id, d: ±1, v}            a strum/pick stroke started (for timing analysis)
//     {t, e:"note",   s: string 0-5, m: midi, v: 0-1, id, mute?}   one string sounding
//     {t, e:"damp",   s}                        a string stopped (chord change / palm)
//     {t, e:"chuck",  d, v, id}                 muted strum with no chord held
//     {t, e:"glide",  semis, dur}               slide along the neck (ringing strings bend)
//     {t, e:"voice",  voice}                    sound changed mid-song
//     {t, e:"chord",  name, label}              chord shown (for lyrics / AI prompt)
//     {t, e:"drum",   i: kick|snare|hat|crash, v, x}   AI band hit
//     {t, e:"bass",   m, dur, v}                AI band bass note
//   ],
//   tempo: {bpm, beat0} (optional), backing: {id, offset} (Create-a-song only)
// }

import { estimateTempo, localGrid, remapTime } from "./tempo.js";

export const MAX_SECONDS = 600;
export const MAX_EVENTS = 40000;

export class Recorder {
  constructor(){ this.reset(); }
  reset(){ this.on=false; this.t0=0; this.events=[]; this.voice="acoustic"; }
  start(now, voice){ this.reset(); this.on=true; this.t0=now; this.voice=voice; }
  push(now, ev){
    if(!this.on) return;
    const t = Math.max(0, now - this.t0);
    if(t > MAX_SECONDS || this.events.length >= MAX_EVENTS) return;
    this.events.push({ t: +t.toFixed(4), ...ev });
  }
  stop(now){
    this.on = false;
    const events = this.events.slice().sort((a,b)=>a.t-b.t);
    const last = events.length ? events[events.length-1].t : 0;
    return { v:1, voice:this.voice, duration: +Math.min(MAX_SECONDS, Math.max(last+2.5, now-this.t0)).toFixed(3), studio:false, events };
  }
}

export function strokeTimes(perf){
  return perf.events.filter(e=>e.e==="stroke"||e.e==="chuck").map(e=>e.t);
}

export function analyse(perf){
  const times = strokeTimes(perf);
  const tempo = estimateTempo(times);
  const chordTime = {};
  const chords = perf.events.filter(e=>e.e==="chord");
  chords.forEach((c,i)=>{ const end = i+1<chords.length ? chords[i+1].t : perf.duration; chordTime[c.name] = (chordTime[c.name]||0) + Math.max(0, end-c.t); });
  // progression in order, with repeats squashed
  const prog=[]; for(const c of chords){ if(prog[prog.length-1] !== c.label) prog.push(c.label); }
  return { tempo, chordTime, progression: prog.slice(0, 32), strokes: times.length };
}

// ---------- Enhance: same playing, tighter and smoother ----------
// • strokes pulled onto the beat grid (16ths), most of the way, following the player's own drift
// • accidental tiny double-hits removed
// • loudness evened out (keeps accents, removes wild jumps)
// • studio sound switched on for playback (wider, richer)
export function enhance(perf, {strength=0.8} = {}){
  const out = JSON.parse(JSON.stringify(perf));
  const strokes = out.events.filter(e=>e.e==="stroke"||e.e==="chuck");
  const times = strokes.map(e=>e.t);
  const tempo = estimateTempo(times);
  out.studio = true;
  if(tempo.confidence < 0.25 || strokes.length < 4){ out.tempo = tempo.bpm ? {bpm:tempo.bpm, beat0:tempo.beat0} : undefined; return levelOnly(out); }
  const snapDelta = (t) => {          // how far t is from the nearest 16th of the local grid
    const g = localGrid(times, t, tempo.bpm, tempo.beat0), p16 = g.p8/2;
    const k = Math.round((t - g.phase)/p16), d = g.phase + k*p16 - t;
    return Math.abs(d) < p16*0.5 ? d : 0;
  };

  // 1) remove accidental double-hits: a weak stroke right after another one
  const drop = new Set();
  for(let i=1;i<strokes.length;i++){
    const a=strokes[i-1], b=strokes[i];
    if(b.t - a.t < 0.07 && (b.v||0) < (a.v||0)*0.8) drop.add(b.id ?? ("c"+i));
  }

  // 2) where each stroke should move to
  const shift = new Map();  // stroke id -> delta seconds
  for(const s of strokes) shift.set(s.id ?? s, snapDelta(s.t)*strength);
  const deltaFor = (ev) => {
    if(ev.e==="chuck") return shift.get(ev.id ?? ev) || 0;
    return shift.get(ev.id) || 0;
  };

  // 3) loudness: compress each stroke's level towards the average
  const vs = strokes.map(s=>s.v||0.6), mean = vs.reduce((a,b)=>a+b,0)/vs.length;
  const gainFor = new Map();
  for(const s of strokes){ const v=s.v||0.6; const nv = Math.max(0.35, Math.min(0.95, mean + (v-mean)*0.5)); gainFor.set(s.id ?? s, nv/v); }

  out.events = out.events.filter(ev => !((ev.e==="stroke"||ev.e==="note") && drop.has(ev.id)));
  for(const ev of out.events){
    if(ev.e==="stroke"||ev.e==="note"||ev.e==="chuck"){
      ev.t = +Math.max(0, ev.t + deltaFor(ev)).toFixed(4);
      const g = gainFor.get(ev.e==="chuck" ? (ev.id ?? ev) : ev.id);
      if(g && ev.v!==undefined) ev.v = +Math.min(1, ev.v*g).toFixed(3);
    } else if(ev.e==="glide" || ev.e==="chord"){
      // snap neck slides and chord changes to the nearest 16th as well
      ev.t = +Math.max(0, ev.t + snapDelta(ev.t)*strength).toFixed(4);
    }
  }
  // inside one stroke, a little tighter (cleaner strum) but never re-ordered
  const byId = new Map();
  for(const ev of out.events) if(ev.e==="note"){ (byId.get(ev.id) || byId.set(ev.id, []).get(ev.id)).push(ev); }
  for(const notes of byId.values()){
    notes.sort((a,b)=>a.t-b.t);
    const t0 = notes[0].t;
    for(const n of notes) n.t = +(t0 + (n.t - t0)*0.8).toFixed(4);
  }
  out.events.sort((a,b)=>a.t-b.t);
  out.tempo = {bpm: tempo.bpm, beat0: tempo.beat0};
  return out;
}
function levelOnly(out){
  const vs = out.events.filter(e=>e.e==="stroke").map(e=>e.v||0.6);
  if(!vs.length) return out;
  const mean = vs.reduce((a,b)=>a+b,0)/vs.length;
  for(const ev of out.events) if((ev.e==="note"||ev.e==="chuck") && ev.v!==undefined) ev.v = +Math.max(0.3, Math.min(0.95, mean + (ev.v-mean)*0.6)).toFixed(3);
  return out;
}

// ---------- Create a song: keep the guitar, line it up with the AI backing ----------
// The guitar notes are exactly what the player played; only their timing is mapped from the
// player's beat grid onto the backing track's beat grid (which was generated at the same tempo).
export function alignToBacking(perf, playerTempo, backingBeats, backingId){
  const out = JSON.parse(JSON.stringify(perf));
  // the player's first strum (snapped to their own grid) lines up with the backing's first downbeat
  const firstStroke = out.events.find(e=>e.e==="stroke"||e.e==="chuck");
  const p8 = 30/playerTempo.bpm, t1 = firstStroke ? firstStroke.t : 0;
  const from = { bpm: playerTempo.bpm, beat0: playerTempo.beat0 + Math.round((t1 - playerTempo.beat0)/p8)*p8 };
  const to = { bpm: backingBeats.bpm, beat0: backingBeats.downbeat0 ?? backingBeats.beat0 };
  out.events = out.events
    .filter(e=>e.e!=="drum" && e.e!=="bass")       // the AI plays drums and bass now
    .map(e=>({ ...e, t: +Math.max(0, remapTime(e.t, from, to)).toFixed(4) }))
    .sort((a,b)=>a.t-b.t);
  const last = out.events.length ? out.events[out.events.length-1].t : 0;
  out.duration = +Math.max(last + 2.5, out.duration * 60/backingBeats.bpm * playerTempo.bpm/60).toFixed(3);
  out.tempo = { bpm: backingBeats.bpm, beat0: to.beat0 };
  out.backing = { id: backingId, offset: 0 };
  return out;
}

// what the AI is asked for: the musical facts of the performance
export function songBrief(perf, analysis){
  const bpm = Math.round(analysis.tempo.bpm || 110);
  const barSec = 240/bpm;
  // whole bars, plus one bar of ending
  const bars = Math.max(4, Math.min(64, Math.ceil(perf.duration/barSec) + 1));
  return { bpm, bars, durationMs: Math.round(bars*barSec*1000), progression: analysis.progression, voice: perf.voice };
}

export function validatePerformance(perf){
  if(!perf || perf.v !== 1 || !Array.isArray(perf.events)) return "bad performance";
  if(!["acoustic","rock","metal"].includes(perf.voice)) return "bad voice";
  if(!(perf.duration > 0 && perf.duration <= MAX_SECONDS + 5)) return "bad duration";
  if(perf.events.length > MAX_EVENTS) return "too many events";
  const kinds = new Set(["stroke","note","damp","chuck","glide","voice","chord","drum","bass"]);
  for(const e of perf.events){
    if(!e || typeof e.t !== "number" || !(e.t >= 0) || e.t > MAX_SECONDS + 60 || !kinds.has(e.e)) return "bad event";
    if(e.e==="note" && !(e.s>=0 && e.s<=5 && e.m>=24 && e.m<=100)) return "bad note";
  }
  return null;
}
