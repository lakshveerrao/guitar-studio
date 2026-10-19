// Plays a recorded performance back (live, with a lookahead scheduler) or renders it to audio.

import { AudioEngine } from "./sound.js";

function setsFor(perf){
  const voices = new Set([perf.voice, ...perf.events.filter(e=>e.e==="voice").map(e=>e.voice)]);
  const sets = new Set();
  for(const v of voices) sets.add(v === "acoustic" ? "acoustic" : "electric");
  if(perf.events.some(e=>e.e==="bass")) sets.add("bass");
  return [...sets];
}

function fire(engine, ev, t){
  switch(ev.e){
    case "note":  engine.note(ev.s, ev.m, t, ev.v ?? 0.6, { mute: !!ev.mute }); break;
    case "damp":  engine.damp(ev.s, t, true); break;
    case "chuck": engine.chuck(ev.d || 1, ev.v ?? 0.6, t); break;
    case "glide": engine.glide(ev.semis, t, ev.dur || 0.12); break;
    case "voice": engine.setVoice(ev.voice, t, true); break;
    case "drum":  engine.drum(ev.i, t, ev.v ?? 1, ev.x || 0); break;
    case "bass":  engine.bass(ev.m, t, ev.dur || 0.3, ev.v ?? 1); break;
  }
}

export class Player {
  constructor(engine, { onEvent = null, onEnd = null } = {}){
    this.engine = engine; this.onEvent = onEvent; this.onEnd = onEnd; this.timer = null; this.backingSrc = null;
  }
  get ctx(){ return this.engine.ctx; }
  async play(perf, { backing = null, from = 0, backingGain = 0.85 } = {}){
    this.stop();
    await this.engine.load(setsFor(perf));
    const rec = this.engine.onEvent; this.engine.onEvent = null; this.savedHook = rec;
    this.engine.setVoice(perf.voice, this.ctx.currentTime, true);
    this.engine.setStudio(!!perf.studio);
    for(const e of perf.events){ if(e.e === "voice" && e.t <= from) this.engine.setVoice(e.voice, this.ctx.currentTime, true); }
    this.perf = perf; this.t0 = this.ctx.currentTime + 0.1 - from; this.i = perf.events.findIndex(e => e.t >= from);
    if(this.i < 0) this.i = perf.events.length;
    if(backing){
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); g.gain.value = backingGain;
      s.buffer = backing; s.connect(g); g.connect(this.engine.comp);
      s.start(this.t0 + from, from + (perf.backing?.offset || 0)); this.backingSrc = s;
    }
    this.timer = setInterval(() => this.pump(), 40); this.pump();
  }
  pump(){
    const ev = this.perf.events, horizon = this.ctx.currentTime + 0.25;
    while(this.i < ev.length && this.t0 + ev[this.i].t < horizon){
      const e = ev[this.i++], t = this.t0 + e.t;
      fire(this.engine, e, t);
      if(this.onEvent){ const ms = Math.max(0, (t - this.ctx.currentTime)*1000); setTimeout(() => this.onEvent && this.onEvent(e), ms); }
    }
    if(this.ctx.currentTime > this.t0 + this.perf.duration){ this.stop(); if(this.onEnd) this.onEnd(); }
  }
  position(){ return this.perf ? Math.max(0, this.ctx.currentTime - this.t0) : 0; }
  stop(){
    clearInterval(this.timer); this.timer = null;
    if(this.backingSrc){ try{ this.backingSrc.stop(); }catch(e){} this.backingSrc = null; }
    for(let s=0;s<6;s++) this.engine.damp(s, this.ctx.currentTime, true);
    if(this.savedHook !== undefined){ this.engine.onEvent = this.savedHook; this.savedHook = undefined; }
  }
}

// Render a whole performance to an AudioBuffer (for downloads, sharing, and tests).
export async function renderOffline(perf, { sampleRate = 44100, backing = null, sampleBase = "/samples/", useSamples = true, backingGain = 0.85 } = {}){
  const len = Math.ceil((perf.duration + 1) * sampleRate);
  const off = new OfflineAudioContext(2, len, sampleRate);
  const engine = new AudioEngine(off, { sampleBase, useSamples });
  await engine.load(setsFor(perf));
  engine.setVoice(perf.voice, 0, true);
  engine.setStudio(!!perf.studio, 0);
  if(backing){
    const s = off.createBufferSource(), g = off.createGain(); g.gain.value = backingGain;
    s.buffer = backing; s.connect(g); g.connect(engine.comp); s.start(0.05, perf.backing?.offset || 0);
  }
  for(const e of perf.events) fire(engine, e, 0.05 + e.t);
  return off.startRendering();
}

export function encodeWav(buf){
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n*ch*2));
  const w = (o, s) => { for(let i=0;i<s.length;i++) out.setUint8(o+i, s.charCodeAt(i)); };
  w(0,"RIFF"); out.setUint32(4, 36 + n*ch*2, true); w(8,"WAVE"); w(12,"fmt ");
  out.setUint32(16,16,true); out.setUint16(20,1,true); out.setUint16(22,ch,true); out.setUint32(24,sr,true);
  out.setUint32(28,sr*ch*2,true); out.setUint16(32,ch*2,true); out.setUint16(34,16,true); w(36,"data"); out.setUint32(40,n*ch*2,true);
  const data = []; for(let c=0;c<ch;c++) data.push(buf.getChannelData(c));
  let o = 44; for(let i=0;i<n;i++) for(let c=0;c<ch;c++){ const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v*32767, true); o += 2; }
  return out.buffer;
}
