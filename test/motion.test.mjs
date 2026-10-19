import { Motion, Calibrator, GYRO_LSB, ACC_LSB } from "../public/js/core/motion.js";
import { voicing, strokeStrings, guessKey, transposeName } from "../public/js/core/chords.js";
import assert from "node:assert/strict";

let pass = 0, fail = 0;
function test(name, fn){ try { fn(); pass++; console.log("PASS", name); } catch(e){ fail++; console.log("FAIL", name, "->", e.message); } }

const G = 16384;
function rnd(n){ return (Math.random()*2-1)*n; }
// build a packet: accel in g [x,y,z], gyro in deg/s [x,y,z]
const pkt = (pads, acc, gyro) => ({ pads, capOk:true, raw:[...acc.map(v=>Math.round(v*G)), ...gyro.map(v=>Math.round(v*GYRO_LSB))] });
const level = () => [0, 0, 1];
const tilted = (axis, deg) => { const a=[0,0,0]; const r=deg*Math.PI/180; a[axis]=Math.sin(r); a[2]=Math.cos(r); return a; };

function rig(settings = {}){
  const ev = [];
  const m = new Motion(settings, {
    onStrokeStart: e => ev.push({k:"start", ...e}),
    onStrokeNext: e => ev.push({k:"next", ...e}),
    onStrokeEnd: e => { const st = ev.filter(x=>x.k==="start"&&x.id===e.id)[0]; ev.push({k:"strum", dir:e.dir, count:e.count, center: st.center, vel: st.vel, t: st.t}); },
    onSlide: (dir, pos, t) => ev.push({k:"slide", dir, pos, t}),
    onZone: z => ev.push({k:"zone", ...z})
  });
  let t = 1000;
  const run = (frames) => { for(const f of frames){ t += 16; if(f.fret) m.feed("fret", f.fret, t); if(f.strum) m.feed("strum", f.strum, t); } };
  return { m, ev, run, now: () => t };
}
const hold = (n, fret, strum) => Array.from({length:n}, () => ({ fret: fret && fret(), strum: strum && strum() }));
// one swing on gyro axis (0..2) with peak deg/s, n frames (16 ms each)
function swing(axis, peak, n, fretFn){
  return Array.from({length:n}, (_, i) => { const g=[0,0,0]; g[axis]=peak*Math.sin(Math.PI*i/(n-1)); return { fret: fretFn && fretFn(), strum: pkt(0, level(), g) }; });
}

// ---------------- strum size -> number of strings ----------------
test("small flick hits 1-2 strings", () => {
  const r = rig(); r.run(hold(5, () => pkt(1, level(), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  // flick: ~20° total (peak 260 °/s over 6 frames ≈ 96 ms)
  r.run(swing(2, 260, 6, () => pkt(1, level(), [0,0,0])));
  r.run(hold(10, () => pkt(1, level(), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  const s = r.ev.filter(e=>e.k==="strum");
  assert.equal(s.length, 1); assert.ok(s[0].count <= 2, "count " + s[0].count);
});
test("medium swing hits 3-4 strings", () => {
  const r = rig(); r.run(hold(5, null, () => pkt(0, level(), [0,0,0])));
  r.run(swing(2, 300, 11)); r.run(hold(10, null, () => pkt(0, level(), [0,0,0])));
  const s = r.ev.filter(e=>e.k==="strum"); assert.equal(s.length, 1);
  assert.ok(s[0].count >= 3 && s[0].count <= 4, "count " + s[0].count);
});
test("full swing hits all 6", () => {
  const r = rig(); r.run(hold(5, null, () => pkt(0, level(), [0,0,0])));
  r.run(swing(2, 380, 16)); r.run(hold(10, null, () => pkt(0, level(), [0,0,0])));
  const s = r.ev.filter(e=>e.k==="strum"); assert.equal(s.length, 1); assert.equal(s[0].count, 6);
});
test("fast down-up-down-up = 4 strums alternating", () => {
  const r = rig(); r.run(hold(5, null, () => pkt(0, level(), [0,0,0])));
  for(let k=0;k<4;k++) r.run(swing(2, k%2 ? -330 : 330, 9));
  r.run(hold(10, null, () => pkt(0, level(), [0,0,0])));
  assert.deepEqual(r.ev.filter(e=>e.k==="strum").map(e=>e.dir), [1,-1,1,-1]);
});
test("first string sounds on the same packet the swing crosses the threshold", () => {
  const r = rig(); r.run(hold(5, null, () => pkt(0, level(), [0,0,0])));
  const frames = swing(2, 380, 16); let crossT = null;
  for(const f of frames){ r.run([f]); if(crossT===null && Math.abs(f.strum.raw[5]/GYRO_LSB) > 150) crossT = r.now(); if(r.ev.length) break; }
  assert.ok(r.ev[0].k === "start" && r.ev[0].t === crossT, "latency " + (r.ev[0].t - crossT));
});
test("strings follow the hand: spacing grows when the swing is slower", () => {
  const spread = (peak, n) => { const r = rig(); r.run(hold(5, null, () => pkt(0, level(), [0,0,0])));
    let t0=null; const times=[]; const m=r.m; const cb=m.cb;
    m.cb = { onStrokeStart: e => { t0 = r.now(); times.push(0); }, onStrokeNext: e => times.push(r.now()-t0 + e.delay) };
    r.run(swing(2, peak, n)); r.run(hold(8, null, () => pkt(0, level(), [0,0,0])));
    return times; };
  const fast = spread(900, 7), slow = spread(380, 16);
  assert.ok(fast.length >= 5 && slow.length >= 5, `${fast.length} / ${slow.length} strings`);
  const span = a => a[a.length-1]-a[0];
  assert.ok(span(fast) < span(slow), `fast ${span(fast).toFixed(0)}ms vs slow ${span(slow).toFixed(0)}ms`);
  for(let i=1;i<fast.length;i++) assert.ok(fast[i] >= fast[i-1], "string order kept in time");
});
test("hand shake does not strum", () => {
  const r = rig(); r.run(hold(120, null, () => pkt(0, level(), [rnd(60), rnd(60), rnd(60)])));
  assert.equal(r.ev.filter(e=>e.k==="strum").length, 0);
});

// ---------------- front/back tilt -> rows ----------------
test("tilt fret neck up/down changes row; strum remote tilt does not", () => {
  const r = rig();
  r.run(hold(10, () => pkt(1, tilted(1, 35), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  assert.equal(r.m.zone.row, "up");
  r.run(hold(10, () => pkt(1, tilted(1, -35), [0,0,0]), () => pkt(0, tilted(1, 40), [0,0,0])));
  assert.equal(r.m.zone.row, "down");
  r.run(hold(10, () => pkt(1, level(), [0,0,0]), () => pkt(0, tilted(1, 40), [0,0,0])));
  assert.equal(r.m.zone.row, "level");
});
test("twist columns only when enabled", () => {
  const r = rig({ twist:true, twistAxis:0 });
  r.run(hold(10, () => pkt(1, tilted(0, 35), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  assert.equal(r.m.zone.col, "right");
  const r2 = rig(); r2.run(hold(10, () => pkt(1, tilted(0, 35), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  assert.equal(r2.m.zone.col, "center");
});

// ---------------- left/right slide along the neck ----------------
// quick slide: acceleration burst along X (towards body = +), then braking burst
function slideFrames(sign, peakG = 0.9){
  const f = [];
  for(let i=0;i<14;i++){
    const ph = i/13; const ax = sign*peakG*Math.sin(2*Math.PI*ph);   // push then brake
    f.push({ fret: pkt(1, [ax, 0, 1], [rnd(10), rnd(10), rnd(10)]), strum: pkt(0, level(), [0,0,0]) });
  }
  return f;
}
test("slide towards body moves up 2 frets, back moves down", () => {
  const r = rig(); r.run(hold(40, () => pkt(1, level(), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  r.run(slideFrames(+1)); r.run(hold(30, () => pkt(1, level(), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  assert.equal(r.m.pos, 2, "after slide up pos=" + r.m.pos);
  r.run(slideFrames(+1)); r.run(hold(30, () => pkt(1, level(), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  assert.equal(r.m.pos, 4);
  r.run(slideFrames(-1)); r.run(hold(30, () => pkt(1, level(), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  assert.equal(r.m.pos, 2);
  assert.equal(r.ev.filter(e=>e.k==="slide").length, 3);
});
test("a quick neck tilt is not mistaken for a slide", () => {
  const r = rig(); r.run(hold(40, () => pkt(1, level(), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  // rotate 40° about Y in 10 frames: gravity moves onto X, gyro shows the rotation
  for(let i=0;i<=10;i++) r.run([{ fret: pkt(1, tilted(0, 4*i), [0, 250, 0]), strum: pkt(0, level(), [0,0,0]) }]);
  r.run(hold(60, () => pkt(1, tilted(0, 40), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  for(let i=10;i>=0;i--) r.run([{ fret: pkt(1, tilted(0, 4*i), [0, -250, 0]), strum: pkt(0, level(), [0,0,0]) }]);
  r.run(hold(60, () => pkt(1, level(), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  assert.equal(r.ev.filter(e=>e.k==="slide").length, 0);
});
test("strum remote swinging does not move fret position", () => {
  const r = rig(); r.run(hold(40, () => pkt(1, level(), [0,0,0]), () => pkt(0, level(), [0,0,0])));
  for(let k=0;k<6;k++) r.run(swing(2, k%2?-350:350, 10, () => pkt(1, level(), [rnd(15),rnd(15),rnd(15)])));
  assert.equal(r.m.pos, 0);
});
test("no slide with only one remote", () => {
  const ev=[]; const m = new Motion({}, { onSlide: () => ev.push(1) }); let t=0;
  for(let i=0;i<40;i++) m.feed("fret", pkt(1, level(), [0,0,0]), t+=16);
  for(const f of slideFrames(1)) m.feed("fret", f.fret, t+=16);
  assert.equal(ev.length, 0);
});

// ---------------- pick mode ----------------
test("pick mode: hand height chooses the string", () => {
  const r = rig({ pickMode:true, pickAxis:1 });
  r.run(hold(5, () => pkt(1, level(), [0,0,0]), () => pkt(0, tilted(1, 30), [0,0,0])));
  r.run(swing(2, 250, 6, () => pkt(1, level(), [0,0,0])).map(f => ({ ...f, strum: { ...f.strum, raw: [...pkt(0, tilted(1,30), [0,0,0]).raw.slice(0,3), ...f.strum.raw.slice(3)] } })));
  r.run(hold(10, () => pkt(1, level(), [0,0,0]), () => pkt(0, tilted(1, -30), [0,0,0])));
  r.run(swing(2, 250, 6, () => pkt(1, level(), [0,0,0])).map(f => ({ ...f, strum: { ...f.strum, raw: [...pkt(0, tilted(1,-30), [0,0,0]).raw.slice(0,3), ...f.strum.raw.slice(3)] } })));
  const s = r.ev.filter(e=>e.k==="strum");
  assert.equal(s.length, 2); assert.ok(s[0].center < 0.5 && s[1].center > 4.5, JSON.stringify(s.map(x=>x.center)));
  const notes = voicing("G").notes;
  assert.deepEqual(strokeStrings(notes, 1, 1, s[0].center), [0]);   // low E only
  assert.deepEqual(strokeStrings(notes, 1, 1, s[1].center), [5]);   // high E only
});

// ---------------- auto setup ----------------
test("calibrator finds strum, tilt and neck axes", () => {
  const r = rig(); const c = new Calibrator(r.m);
  const feed = (fr) => { for(const f of fr){ r.run([f]); if(f.fret) c.add("fret", f.fret.raw); if(f.strum) c.add("strum", f.strum.raw); } };
  feed(hold(60, () => pkt(0, level(), [rnd(2),rnd(2),rnd(2)]), () => pkt(0, level(), [rnd(2),rnd(2),rnd(2)]))); c.finish("still");
  for(let k=0;k<10;k++) feed(swing(0, k%2?-250:250, 9, () => pkt(0, level(), [0,0,0]))); assert.equal(c.finish("strum").strumAxis, 3);
  feed(hold(80, () => pkt(0, tilted(1, -40), [0,0,0]), () => pkt(0, level(), [0,0,0]))); const t = c.finish("tilt");
  assert.equal(t.tiltAxis, 1); assert.equal(r.m.S.tiltInv, true);
  // neck along Z-ish? use Y-axis slides with first push negative
  const sf = []; for(let k=0;k<3;k++) for(let i=0;i<14;i++){ const v=-0.8*Math.sin(2*Math.PI*i/13); sf.push({ fret: pkt(0, [0, v, 1], [0,0,0]), strum: pkt(0, level(), [0,0,0]) }); }
  // tilt axis is Y here, so give the slide on X instead
  const sx = sf.map(f => ({ ...f, fret: pkt(0, [f.fret.raw[1]/G, 0, 1], [0,0,0]) }));
  feed(sx); const s = c.finish("slide");
  assert.equal(s.neckAxis, 0); assert.equal(r.m.S.neckInv, true);
});

// ---------------- chords ----------------
test("strokeStrings: down from low side, up from high side, skips muted strings", () => {
  const C = voicing("C").notes;            // x32010 -> strings 1..5
  assert.deepEqual(strokeStrings(C, 1, 2), [1,2]);
  assert.deepEqual(strokeStrings(C, -1, 2), [5,4]);
  assert.deepEqual(strokeStrings(C, 1, 6), [1,2,3,4,5]);
});
test("slide position transposes chords like moving up the neck", () => {
  assert.equal(voicing("G","acoustic",2).label, "A");
  assert.equal(voicing("Em","acoustic",2).label, "F#m");
  assert.equal(voicing("G","metal",2).label, "A5");
  assert.equal(voicing("G","acoustic",2).notes[0], 45);
  assert.equal(transposeName("Am", 3), "Cm");
});
test("key guess", () => {
  assert.equal(guessKey({G:4, C:2, D:2, Em:1}), "G major");
  assert.equal(guessKey({Am:4, Dm:2, Em:2, F:1}), "A minor");
  assert.equal(guessKey({G:1, C:1, D:1, Em:1}, "G"), "G major");     // I-IV-V-vi starting on G
  assert.equal(guessKey({Em:1, C:1, G:1, D:1}, "Em"), "E minor");    // same chords starting on Em
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
