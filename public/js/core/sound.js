// AirKords sound engine: real recorded guitar strings (FluidR3 samples, CC BY 3.0) through
// an acoustic body / rock amp / metal amp, plus the band (drums + real bass samples).
// Works with a live AudioContext or an OfflineAudioContext (for rendering songs to files).
// If samples can't load (offline), every note falls back to a physically-modelled string.

import { OPEN } from "./chords.js";

const SAMPLE_SETS = {
  acoustic: { dir: "acoustic_guitar_steel", lo: 38, hi: 88 },
  electric: { dir: "electric_guitar_clean", lo: 38, hi: 88 },
  bass:     { dir: "electric_bass_finger",  lo: 24, hi: 52 }
};
const sampleCache = new Map();     // url -> Promise<{buf, offset}>  (shared by every engine)

export const VOICES = ["acoustic", "rock", "metal"];
const LEVEL = { acoustic: 1, rock: 0.42, metal: 0.3 };

export class AudioEngine {
  constructor(ctx, { sampleBase = "/samples/", destination = null, useSamples = true } = {}){
    this.ctx = ctx; this.base = sampleBase; this.useSamples = useSamples;
    this.voice = "acoustic"; this.studio = false;
    this.samples = { acoustic: {}, electric: {}, bass: {} };
    this.strings = [null,null,null,null,null,null];
    this.ksCache = new Map();
    this.onEvent = null;               // recorder hook: (ctxTime, event)
    this.build(destination || ctx.destination);
  }

  // ---------- wiring ----------
  build(dest){
    const ctx = this.ctx;
    this.out = ctx.createGain();
    const lim = ctx.createDynamicsCompressor();      // brick-wall limiter: never clips
    lim.threshold.value=-2; lim.knee.value=0; lim.ratio.value=20; lim.attack.value=0.001; lim.release.value=0.08;
    this.out.connect(lim); lim.connect(dest);
    const comp = this.comp = ctx.createDynamicsCompressor();
    comp.threshold.value=-14; comp.ratio.value=3.5; comp.attack.value=0.004; comp.release.value=0.2;
    comp.connect(this.out);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0); for(let i=0;i<nd.length;i++) nd[i] = Math.random()*2-1;

    // guitar: strings -> bus -> tone -> voice chain -> mix -> studio -> comp (+ room)
    this.bus = ctx.createGain();
    this.tone = this.bq("lowpass", 9000, 0.5);
    this.bus.connect(this.tone);
    this.mix = ctx.createGain();
    this.chains = { acoustic: this.acousticChain(), rock: this.ampChain(false), metal: this.ampChain(true) };
    for(const v of VOICES){ this.tone.connect(this.chains[v].input); this.chains[v].output.connect(this.mix); }

    // studio polish (Enhance): double-tracked width + a touch of chorus + presence
    this.mix.connect(comp);
    this.studioSend = ctx.createGain(); this.studioSend.gain.value = 0;
    const presence = this.bq("peaking", 3200, 0.8, 2.5);
    const dl = ctx.createDelay(0.1), dr = ctx.createDelay(0.1);
    dl.delayTime.value = 0.019; dr.delayTime.value = 0.027;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.6; lfoG.gain.value = 0.0015;
    lfo.connect(lfoG); lfoG.connect(dl.delayTime); lfoG.connect(dr.delayTime); lfo.start();
    const merger = ctx.createChannelMerger(2);
    this.mix.connect(this.studioSend); this.studioSend.connect(presence);
    presence.connect(dl); presence.connect(dr); dl.connect(merger, 0, 0); dr.connect(merger, 0, 1);
    merger.connect(comp);

    // room reverb
    this.rev = ctx.createConvolver(); this.rev.buffer = this.impulse(1.6);
    this.wet = ctx.createGain(); this.mix.connect(this.rev); this.rev.connect(this.wet); this.wet.connect(comp);

    // band: bypasses the guitar amp
    this.bandBus = ctx.createGain(); this.bandBus.connect(comp);
    const bandRev = ctx.createGain(); bandRev.gain.value = 0.06; this.bandBus.connect(bandRev); bandRev.connect(this.rev);

    this.setVoice("acoustic", 0, true);
    this.setVolume(0.8); this.setTone(0.55); this.setBandVolume(0.7);
  }
  bq(type, f, q, g){ const b=this.ctx.createBiquadFilter(); b.type=type; b.frequency.value=f; if(q!==undefined) b.Q.value=q; if(g!==undefined) b.gain.value=g; return b; }
  chain(nodes){ for(let i=0;i<nodes.length-1;i++) nodes[i].connect(nodes[i+1]); return {input:nodes[0], output:nodes[nodes.length-1]}; }
  curve(fn){ const n=4096, c=new Float32Array(n); for(let i=0;i<n;i++){ const x=i/(n-1)*2-1; c[i]=fn(x);} return c; }
  shaper(k, asym){ const w=this.ctx.createWaveShaper(); w.curve=this.curve(x=>Math.tanh(k*(x+asym))-Math.tanh(k*asym)); w.oversample="4x"; return w; }
  acousticChain(){
    // a real steel-string sample already has its body; just a little warmth and air
    return this.chain([this.ctx.createGain(), this.bq("peaking", 120, 1.0, 2), this.bq("peaking", 2600, 0.9, 1.5), this.ctx.createGain()]);
  }
  ampChain(metal){
    const ctx = this.ctx, out = ctx.createGain();
    if(!metal){   // crunchy British-style overdrive + 2x12 cab
      return this.chain([ctx.createGain(), this.bq("highpass",110,0.7), this.bq("peaking",750,0.9,5), this.shaper(3.4,0.08),
        this.bq("highpass",80,0.7), this.bq("peaking",1900,1.0,4), this.bq("lowpass",4600,0.8), this.bq("lowpass",7000,0.6), out]);
    }
    // high gain: tight low end, two gain stages, scooped mids, 4x12 cab, double-tracked wide
    const pre = ctx.createGain();
    const cab = this.chain([this.bq("peaking",110,1.0,5), this.bq("peaking",520,0.8,-7), this.bq("peaking",2900,1.3,4),
      this.bq("lowpass",4800,0.9), this.bq("lowpass",5600,0.7), this.bq("lowpass",7500,0.6)]);
    this.chain([pre, this.bq("highpass",190,0.7), this.bq("peaking",950,0.8,6), this.shaper(14,0.04), this.bq("highpass",70,0.7), this.shaper(3,0), cab.input]);
    const merger = ctx.createChannelMerger(2), d = ctx.createDelay(0.05); d.delayTime.value = 0.016;
    cab.output.connect(merger,0,0); cab.output.connect(d); d.connect(merger,0,1); merger.connect(out);
    return {input:pre, output:out};
  }
  impulse(sec){
    const sr=this.ctx.sampleRate, n=Math.floor(sr*sec), b=this.ctx.createBuffer(2,n,sr);
    for(let c=0;c<2;c++){ const d=b.getChannelData(c); for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,3.2)*(i<sr*0.012?i/(sr*0.012):1); }
    return b;
  }

  // ---------- settings ----------
  setVoice(v, t = this.ctx.currentTime, silent){
    if(!VOICES.includes(v)) return;
    this.voice = v;
    for(const k of VOICES) this.chains[k].output.gain.setTargetAtTime(k===v ? LEVEL[k] : 0, t, 0.02);
    this.wet.gain.setTargetAtTime(v==="metal"?0.08 : v==="rock"?0.12 : 0.18, t, 0.05);
    for(let i=0;i<6;i++) this.damp(i, t, true);
    if(!silent) this.emit(t, {e:"voice", voice:v});
  }
  setStudio(on, t = this.ctx.currentTime){
    this.studio = !!on;
    this.studioSend.gain.setTargetAtTime(on ? 0.55 : 0, t, 0.05);
    this.wet.gain.setTargetAtTime((this.voice==="metal"?0.08 : this.voice==="rock"?0.12 : 0.18) * (on?1.5:1), t, 0.05);
  }
  setVolume(v){ this.out.gain.setTargetAtTime(v*0.9, this.ctx.currentTime, 0.03); }
  setTone(v){ this.tone.frequency.setTargetAtTime(1800 + v*9000, this.ctx.currentTime, 0.03); }
  setBandVolume(v){ this.bandBus.gain.setTargetAtTime(v*0.8, this.ctx.currentTime, 0.03); }
  emit(t, ev){ if(this.onEvent) this.onEvent(t, ev); }

  // ---------- samples ----------
  async load(sets = ["acoustic","electric","bass"]){
    if(!this.useSamples) return;
    const jobs = [];
    for(const name of sets){
      const S = SAMPLE_SETS[name];
      for(let m=S.lo; m<=S.hi; m++){
        const url = `${this.base}${S.dir}/${m}.mp3`;
        if(!sampleCache.has(url)) sampleCache.set(url, fetchSample(this.ctx, url));
        jobs.push(sampleCache.get(url).then(s => { if(s) this.samples[name][m] = s; }));
      }
    }
    await Promise.all(jobs);
  }
  setFor(voice){ return voice === "acoustic" ? "acoustic" : "electric"; }

  // ---------- strings ----------
  // play string s at midi note m. vel 0..1. mute = palm-muted / chuck.
  note(s, m, t, vel, { mute = false, id } = {}){
    const ctx = this.ctx;
    t = Math.max(t, ctx.currentTime);
    this.damp(s, t, true);                          // a string plays one note at a time
    const sm = this.samples[this.setFor(this.voice)][m];
    const src = ctx.createBufferSource();
    let offset = 0;
    if(sm){ src.buffer = sm.buf; offset = sm.offset; }
    else src.buffer = this.ks(m, vel, mute);
    src.detune.value = (Math.random()*2-1)*3;       // real strings are never perfectly in tune
    const g = ctx.createGain();
    const peak = (0.22 + 0.78*Math.pow(vel, 1.4)) * (this.voice==="acoustic" ? 0.55 : 0.6);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.002);
    // softer playing is darker, like a real pick
    const f = this.bq("lowpass", mute ? 1100 : 2200 + 10000*vel, 0.6);
    if(mute){ g.gain.setTargetAtTime(0, t + 0.03, this.voice==="acoustic" ? 0.03 : 0.06); }
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(f); f.connect(g);
    if(pan){ pan.pan.value = (s-2.5)*0.07; g.connect(pan); pan.connect(this.bus); } else g.connect(this.bus);
    const dur = src.buffer.duration - offset;
    src.start(t, offset); src.stop(t + (mute ? 0.4 : dur));
    this.pick(t, vel, s);
    const v = { src, g, rate: 1, t, mute };
    this.strings[s] = mute ? null : v;
    src.onended = () => { if(this.strings[s] === v) this.strings[s] = null; };
    this.emit(t, { e: "note", s, m, v: +vel.toFixed(3), id, ...(mute ? { mute: 1 } : {}) });
  }
  // the little "tick" of the pick hitting the string
  pick(t, vel, s){
    const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = this.bq("bandpass", 3000 + s*350, 1.2), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035*vel + 0.004, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    n.connect(bp); bp.connect(g); g.connect(this.bus); n.start(t, Math.random()*0.5); n.stop(t + 0.02);
  }
  damp(s, t = this.ctx.currentTime, quiet){
    const v = this.strings[s]; if(!v) return;
    try{ v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.012); v.src.stop(t + 0.1); }catch(e){}
    this.strings[s] = null;
    if(!quiet) this.emit(t, { e: "damp", s });
  }
  ringing(){ return this.strings.some(Boolean); }
  // muted strum: acoustic = scratchy "chk", electric = palm-muted low "chug"
  chuck(dir, vel, t = this.ctx.currentTime, id){
    const ctx = this.ctx;
    const silent = this.onEvent; this.onEvent = null;      // record the chuck as one event, not 6 notes
    if(this.voice === "acoustic"){
      const order = dir > 0 ? [0,1,2,3,4,5] : [5,4,3,2,1,0];
      order.forEach((s,k) => this.note(s, OPEN[s]+2, t + k*0.006, 0.4 + 0.4*vel, { mute: true }));
      const n = ctx.createBufferSource(); n.buffer = this.noise;
      const bp = this.bq("bandpass", 1800, 0.9), g = ctx.createGain();
      g.gain.setValueAtTime(0.25*vel + 0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      n.connect(bp); bp.connect(g); g.connect(this.bus); n.start(t, Math.random()*0.5); n.stop(t + 0.06);
    } else {
      for(let s=3; s<6; s++) this.damp(s, t, true);
      [40, 47, 52].forEach((m, s) => this.note(s, m, t + s*0.003, 0.6 + 0.4*vel, { mute: true }));
    }
    this.onEvent = silent;
    this.emit(t, { e: "chuck", d: dir, v: +vel.toFixed(3), id });
  }
  // slide along the neck: every ringing string bends by `semis`, with the squeak of skin on wound strings
  glide(semis, t = this.ctx.currentTime, dur = 0.12){
    const ctx = this.ctx, ratio = Math.pow(2, semis/12);
    let any = false;
    for(const v of this.strings){
      if(!v) continue; any = true;
      v.src.playbackRate.setValueAtTime(v.rate, t);
      v.rate *= ratio;
      v.src.playbackRate.exponentialRampToValueAtTime(v.rate, t + dur);
    }
    if(any){
      const n = ctx.createBufferSource(); n.buffer = this.noise;
      const bp = this.bq("bandpass", 2500, 4), g = ctx.createGain();
      bp.frequency.setValueAtTime(semis > 0 ? 1800 : 4200, t); bp.frequency.exponentialRampToValueAtTime(semis > 0 ? 4200 : 1800, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + dur*0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur*1.2);
      n.connect(bp); bp.connect(g); g.connect(this.bus); n.start(t, Math.random()*0.5); n.stop(t + dur*1.3);
    }
    this.emit(t, { e: "glide", semis, dur });
  }

  // physically-modelled string (Karplus-Strong) used when samples aren't available
  ks(midi, vel, mute){
    const level = mute ? -1 : vel < 0.35 ? 0 : vel < 0.7 ? 1 : 2;
    const elec = this.voice !== "acoustic", key = midi + "|" + level + "|" + elec;
    if(this.ksCache.has(key)) return this.ksCache.get(key);
    const sr = this.ctx.sampleRate, f = 440*Math.pow(2,(midi-69)/12);
    const dur = mute ? 0.4 : (elec ? 4.5 : 3.4), N = Math.floor(sr*dur), y = new Float32Array(N);
    const D = sr/f - 0.5, Di = Math.floor(D), fr = D - Di;
    const bright = mute ? 0.4 : elec ? [0.6,0.75,0.9][level] : [0.35,0.55,0.8][level];
    let lp = 0; const exc = new Float32Array(Di+2);
    for(let i=0;i<exc.length;i++){ lp += bright*((Math.random()*2-1) - lp); exc[i]=lp; }
    const pp = Math.max(1, Math.round(Di*(elec?0.08:0.13)));
    for(let i=0;i<exc.length;i++) y[i] = exc[i] - (i>=pp ? exc[i-pp] : 0)*0.85;
    const t60 = mute ? 0.12 : elec ? Math.max(3, 7.5-(midi-40)*0.12) : Math.max(1.6, 4.6-(midi-40)*0.09);
    const g = Math.pow(10, -3/(t60*f));
    for(let n=Di+2;n<N;n++){ const a=(1-fr)*y[n-Di]+fr*y[n-Di-1], b=(1-fr)*y[n-Di-1]+fr*y[n-Di-2]; y[n]=g*0.5*(a+b); }
    let px=0, py=0, peak=1e-6;
    for(let n=0;n<N;n++){ const x=y[n], o=x-px+0.995*py; px=x; py=o; y[n]=o; if(Math.abs(o)>peak) peak=Math.abs(o); }
    const fade = Math.floor(sr*0.05);
    for(let n=0;n<N;n++){ y[n]/=peak; if(n>N-fade) y[n]*=(N-n)/fade; }
    const b = this.ctx.createBuffer(1, N, sr); b.getChannelData(0).set(y);
    this.ksCache.set(key, b); return b;
  }

  // ---------- band instruments ----------
  env(g, t, peak, dec){ g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(peak,t+0.002); g.gain.exponentialRampToValueAtTime(0.0001,t+dec); }
  drum(i, t, v = 1, x = 0){
    const ctx = this.ctx, B = this.bandBus;
    t = Math.max(t, ctx.currentTime);
    if(i === "kick"){
      const tight = !!x, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(tight?190:150, t); o.frequency.exponentialRampToValueAtTime(45, t+(tight?0.06:0.12));
      this.env(g, t, 0.9*v, tight?0.16:0.38); o.connect(g); g.connect(B); o.start(t); o.stop(t+0.4);
      const n = ctx.createBufferSource(); n.buffer = this.noise; const hp = this.bq("highpass",2500,0.7), ng = ctx.createGain();
      this.env(ng, t, (tight?0.35:0.15)*v, 0.012); n.connect(hp); hp.connect(ng); ng.connect(B); n.start(t, Math.random()*0.5); n.stop(t+0.03);
    } else if(i === "snare"){
      const soft = !!x, n = ctx.createBufferSource(); n.buffer = this.noise;
      const hp = this.bq("highpass", soft?2500:1500, 0.7), g = ctx.createGain();
      this.env(g, t, (soft?0.3:0.6)*v, soft?0.1:0.2); n.connect(hp); hp.connect(g); g.connect(B); n.start(t, Math.random()*0.5); n.stop(t+0.25);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type="triangle"; o.frequency.setValueAtTime(220,t); o.frequency.exponentialRampToValueAtTime(160,t+0.06);
      this.env(og, t, (soft?0.2:0.5)*v, 0.09); o.connect(og); og.connect(B); o.start(t); o.stop(t+0.12);
    } else if(i === "hat" || i === "open" || i === "ride"){
      const n = ctx.createBufferSource(); n.buffer = this.noise;
      const ride = i==="ride", hp = this.bq("highpass", ride?5000:7000, 0.7), pk = this.bq("peaking", ride?6500:10000, 1, 6), g = ctx.createGain();
      const d = i==="open" ? 0.3 : ride ? 0.35 : 0.045;
      this.env(g, t, 0.32*v, d); n.connect(hp); hp.connect(pk); pk.connect(g); g.connect(B); n.start(t, Math.random()*0.5); n.stop(t+d+0.02);
    } else if(i === "crash"){
      const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
      const hp = this.bq("highpass", 4200, 0.6), g = ctx.createGain();
      this.env(g, t, 0.35*v, 1.6); n.connect(hp); hp.connect(g); g.connect(B); n.start(t); n.stop(t+1.7);
    }
    this.emit(t, { e: "drum", i, v: +v.toFixed(2), ...(x ? { x: 1 } : {}) });
  }
  bass(m, t, dur, v = 1){
    const ctx = this.ctx; t = Math.max(t, ctx.currentTime);
    const sm = this.samples.bass[m], g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.75*v, t+0.005);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.03);
    g.connect(this.bandBus);
    if(sm){
      const src = ctx.createBufferSource(); src.buffer = sm.buf;
      const lp = this.bq("lowpass", this.voice==="metal" ? 1400 : 900, 0.8);
      src.connect(lp); lp.connect(g); src.start(t, sm.offset); src.stop(t + dur + 0.2);
    } else {
      const f = 440*Math.pow(2,(m-69)/12), o = ctx.createOscillator(), sub = ctx.createOscillator(), sg = ctx.createGain();
      o.type="sawtooth"; sub.type="sine"; o.frequency.value=f; sub.frequency.value=f; sg.gain.value=0.7;
      const lp = this.bq("lowpass", this.voice==="metal" ? 1100 : 650, 1.2), og = ctx.createGain(); og.gain.value = 0.45;
      o.connect(lp); sub.connect(sg); sg.connect(lp); lp.connect(og); og.connect(g);
      o.start(t); sub.start(t); o.stop(t+dur+0.2); sub.stop(t+dur+0.2);
    }
    this.emit(t, { e: "bass", m, dur: +dur.toFixed(3), v: +v.toFixed(2) });
  }
}

async function fetchSample(ctx, url){
  try{
    const r = await fetch(url); if(!r.ok) return null;
    const buf = await ctx.decodeAudioData(await r.arrayBuffer());
    // MP3s start with a little silence: skip to just before the attack
    const d = buf.getChannelData(0); let i = 0;
    while(i < d.length && Math.abs(d[i]) < 0.008) i++;
    return { buf, offset: Math.max(0, (i - 40) / buf.sampleRate) };
  } catch(e){ return null; }
}
