import { estimateTempo, detectBeats, remapTime } from "../public/js/core/tempo.js";
import { Recorder, enhance, analyse, alignToBacking, songBrief, validatePerformance } from "../public/js/core/performance.js";
import assert from "node:assert/strict";

let pass=0, fail=0;
function test(n, f){ try{ f(); pass++; console.log("PASS", n); } catch(e){ fail++; console.log("FAIL", n, "->", e.message); } }
const rnd = (a) => (Math.random()*2-1)*a;

// a fake player: strums 8th notes at bpm with timing sloppiness (s), G C D Em, 4 strings per stroke
function fakePerf(bpm, seconds, sloppy, {drift=0, start=0.37} = {}){
  const r = new Recorder(); r.start(0, "rock");
  const p8 = 30/bpm; let id=0; const chords=["G","C","D","Em"];
  for(let k=0, t=start; t < seconds; k++, t = start + k*p8*(1 + drift*k/100)){
    const tt = t + rnd(sloppy);
    if(k % 8 === 0) r.push(tt-0.01, {e:"chord", name: chords[(k/8)%4], label: chords[(k/8)%4]});
    id++; const d = k%2 ? -1 : 1, v = 0.4 + Math.random()*0.5;
    r.push(tt, {e:"stroke", id, d, v});
    for(let s=0;s<4;s++) r.push(tt + s*0.012, {e:"note", s: d>0? s : 5-s, m: 52+s*5, v, id});
  }
  return r.stop(seconds);
}
const strokeErr = (perf, bpm, beat0) => { const p16 = 15/bpm; const e = perf.events.filter(x=>x.e==="stroke").map(x=>{ const k=Math.round((x.t-beat0)/p16); return Math.abs(x.t-beat0-k*p16)*1000; }); return e.reduce((a,b)=>a+b,0)/e.length; };

test("tempo from sloppy 8th strums (±25 ms) at 120", () => {
  const perf = fakePerf(120, 20, 0.025); const t = estimateTempo(perf.events.filter(e=>e.e==="stroke").map(e=>e.t));
  assert.ok(Math.abs(t.bpm-120) < 1.5, "bpm " + t.bpm);
});
test("tempo works for slow 95 and fast 165", () => {
  for(const bpm of [95, 165]){ const perf = fakePerf(bpm, 20, 0.015); const t = estimateTempo(perf.events.filter(e=>e.e==="stroke").map(e=>e.t)); assert.ok(Math.abs(t.bpm-bpm) < 1.5, bpm+" -> "+t.bpm); }
});
test("enhance: strokes 3x tighter on the beat", () => {
  const perf = fakePerf(120, 20, 0.03);
  const out = enhance(perf);
  const before = strokeErr(perf, out.tempo.bpm, out.tempo.beat0), after = strokeErr(out, out.tempo.bpm, out.tempo.beat0);
  assert.ok(after < before/3, `before ${before.toFixed(1)} ms, after ${after.toFixed(1)} ms`);
  assert.equal(out.studio, true);
});
test("enhance follows a player who slowly speeds up (no snapping to wrong beats)", () => {
  const perf = fakePerf(110, 24, 0.02, {drift: 0.15});
  const out = enhance(perf);
  const s0 = perf.events.filter(e=>e.e==="stroke"), s1 = out.events.filter(e=>e.e==="stroke");
  // a snap to the wrong 16th would move a stroke ~100 ms; real fixes stay well under that
  const maxMove = Math.max(...s0.map((x,i)=>Math.abs(x.t - s1[i].t)))*1000;
  assert.ok(maxMove < 60, "max move " + maxMove.toFixed(1) + " ms");
  // and the playing gets steadier: gaps between strums vary less
  const jit = a => { const g=a.slice(1).map((x,i)=>x.t-a[i].t); const d=g.slice(1).map((x,i)=>Math.abs(x-g[i])); return d.reduce((p,q)=>p+q,0)/d.length*1000; };
  assert.ok(jit(s1) < jit(s0)*0.6, `gap jitter ${jit(s0).toFixed(1)} -> ${jit(s1).toFixed(1)} ms`);
  // order kept
  for(let i=1;i<s1.length;i++) assert.ok(s1[i].t > s1[i-1].t);
});
test("enhance keeps every note, notes stay with their stroke", () => {
  const perf = fakePerf(120, 10, 0.03); const out = enhance(perf);
  assert.equal(out.events.filter(e=>e.e==="note").length, perf.events.filter(e=>e.e==="note").length);
  for(const st of out.events.filter(e=>e.e==="stroke")){
    const ns = out.events.filter(e=>e.e==="note" && e.id===st.id);
    assert.ok(ns.every(n => n.t >= st.t - 1e-6 && n.t - st.t < 0.05));
  }
});
test("enhance evens out loudness but keeps the pitch of every note", () => {
  const perf = fakePerf(120, 10, 0.02); const out = enhance(perf);
  const sd = a => { const m=a.reduce((x,y)=>x+y,0)/a.length; return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length); };
  const v0 = perf.events.filter(e=>e.e==="stroke").map(e=>e.v), v1 = out.events.filter(e=>e.e==="stroke").map(e=>e.v);
  assert.ok(sd(v1) < sd(v0)*0.65, `spread ${sd(v0).toFixed(3)} -> ${sd(v1).toFixed(3)}`);
  assert.deepEqual(out.events.filter(e=>e.e==="note").map(e=>e.m), perf.events.filter(e=>e.e==="note").map(e=>e.m));
});
test("enhance removes an accidental double-hit", () => {
  const perf = fakePerf(120, 6, 0.0);
  const st = perf.events.find(e=>e.e==="stroke");
  perf.events.push({t: st.t+0.03, e:"stroke", id: 999, d:1, v:0.2}, {t: st.t+0.03, e:"note", s:0, m:40, v:0.2, id:999});
  perf.events.sort((a,b)=>a.t-b.t);
  const out = enhance(perf);
  assert.ok(!out.events.some(e=>e.id===999));
});

// fake backing track: kick on every beat (louder on beat 1), hats on 8ths, starting after an intro
function fakeBacking(bpm, seconds, intro, sr=22050){
  const x = new Float32Array(Math.floor(seconds*sr));
  const hit = (t, f, dec, amp) => { const i0=Math.floor(t*sr); for(let i=0;i<sr*dec*4 && i0+i<x.length;i++){ x[i0+i] += amp*Math.sin(2*Math.PI*f*i/sr)*Math.exp(-i/(sr*dec)); } };
  const hat = (t, amp) => { const i0=Math.floor(t*sr); for(let i=0;i<sr*0.03 && i0+i<x.length;i++) x[i0+i] += amp*(Math.random()*2-1)*Math.exp(-i/(sr*0.008)); };
  for(let b=0, t=intro; t<seconds-0.5; b++, t=intro+b*60/bpm){ hit(t, 55, 0.08, b%4===0 ? 0.9 : 0.5); hat(t+30/bpm, 0.15); if(b%2) hat(t, 0.2); }
  for(let i=0;i<x.length;i++) x[i]+= rnd(0.01);
  return x;
}
test("detect beats + downbeat in a backing track", () => {
  const x = fakeBacking(121.3, 16, 0.84);
  const b = detectBeats(x, 22050, 120);
  assert.ok(Math.abs(b.bpm-121.3) < 0.8, "bpm " + b.bpm);
  const p = 60/b.bpm, off = ((b.downbeat0 - 0.84) % (4*p) + 4*p) % (4*p);
  assert.ok(Math.min(off, 4*p-off) < 0.03, "downbeat off by " + (Math.min(off,4*p-off)*1000).toFixed(0) + " ms");
});
test("align: guitar lands on the backing's beats, notes unchanged", () => {
  const perf = fakePerf(120, 12, 0.0, {start: 0.5});
  const an = analyse(perf);
  const out = alignToBacking(perf, an.tempo, {bpm: 121.3, beat0: 0.84, downbeat0: 0.84}, "ai_test");
  const st = out.events.filter(e=>e.e==="stroke");
  const p8 = 30/121.3;
  const err = st.map(s => { const k = Math.round((s.t-0.84)/p8); return Math.abs(s.t-0.84-k*p8)*1000; });
  assert.ok(Math.max(...err) < 5, "max off-grid " + Math.max(...err).toFixed(1) + " ms");
  assert.ok(Math.abs(st[0].t - 0.84) < 0.005, "first strum on the first downbeat: " + st[0].t);
  assert.deepEqual(out.events.filter(e=>e.e==="note").map(e=>[e.s,e.m]), perf.events.filter(e=>e.e==="note").map(e=>[e.s,e.m]));
  assert.equal(out.backing.id, "ai_test");
});
test("song brief: whole bars, progression, tempo", () => {
  const perf = fakePerf(120, 15, 0.01); const b = songBrief(perf, analyse(perf));
  assert.equal(b.bpm, 120); assert.equal(b.durationMs, b.bars*2000);
  assert.deepEqual(b.progression.slice(0,4), ["G","C","D","Em"]);
});
test("validation rejects junk", () => {
  assert.equal(validatePerformance(fakePerf(120, 5, 0)), null);
  assert.ok(validatePerformance({v:1, voice:"rock", duration:5, events:[{t:1, e:"hack"}]}));
  assert.ok(validatePerformance({v:1, voice:"x", duration:5, events:[]}));
  assert.ok(validatePerformance({v:1, voice:"rock", duration:5, events:[{t:1, e:"note", s:9, m:40}]}));
});

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
