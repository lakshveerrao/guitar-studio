// The guitar itself: joins motion (pads, tilt, slide, strokes) to chords and the sound engine,
// feeds the AI band, and records everything for Rough / Enhance / Create a song.

import { voicing, strokeStrings, rootPc } from "./chords.js";

// 3 rows (tilt) x 3 pads. Columns (wrist twist) are optional extra banks.
export const DEFAULT_MAP = {
  center: { up: ["Em","Am","Dm"],    level: ["G","C","D"],        down: ["A","E","F"] },
  left:   { up: ["Em7","Am7","D7"],  level: ["G7","Cmaj7","Dsus4"], down: ["A7","E7","Fmaj7"] },
  right:  { up: ["Bm","Asus2","Esus4"], level: ["B7","C7","Fmaj7"], down: ["D7","A7","E7"] }
};

export class Instrument {
  constructor(engine, { map = DEFAULT_MAP, noPad = "mute", band = null, recorder = null, onChange = null } = {}){
    this.engine = engine; this.map = map; this.noPad = noPad; this.band = band; this.recorder = recorder;
    this.onChange = onChange;
    this.pads = 0; this.zone = { row: "level", col: "center" }; this.pos = 0; this.lastChord = null;
    this.strokes = new Map(); this.lastLabel = null;
    engine.onEvent = (t, ev) => this.rec(t, ev);
  }
  rec(t, ev){
    if(this.recorder && this.recorder.on) this.recorder.push(t, ev);
    if(this.onSound && (ev.e === "note" || ev.e === "chuck" || ev.e === "glide")) this.onSound(ev, t);
  }
  get ctx(){ return this.engine.ctx; }

  // ----- state from the fret hand -----
  setPads(p){ this.pads = p; this.changed(); }
  setZone(z){ this.zone = { row: z.row, col: z.col || "center" }; this.changed(); }
  // slide along the neck. Strings that are still ringing bend to the new position, like a real slide.
  setPosition(pos){
    const d = pos - this.pos; if(!d) return;
    this.pos = pos;
    if(this.heldPad() >= 0 && this.engine.ringing()) this.engine.glide(d, this.ctx.currentTime + 0.003, 0.09 + 0.02*Math.abs(d));
    this.changed();
  }
  changed(){ if(this.onChange) this.onChange(this.current()); }

  heldPad(){ const p = this.pads; return p&4 ? 2 : p&2 ? 1 : p&1 ? 0 : -1; }   // higher fret wins
  chordName(){
    const p = this.heldPad();
    if(p >= 0){ const bank = this.map[this.zone.col] || this.map.center; return bank[this.zone.row][p]; }
    if(this.noPad === "open") return "open";
    if(this.noPad === "last") return this.lastChord;
    return null;
  }
  // what would sound now: {name, label, shape, notes} or null for a muted strum
  current(){
    const name = this.chordName(); if(!name) return null;
    const v = voicing(name, this.engine.voice, this.pos);
    return v ? { name, ...v } : null;
  }
  bassRoot(){
    const c = this.current() || (this.lastChord && { name: this.lastChord });
    if(!c) return null;
    if(c.name === "open") return 28 + this.pos;
    return 28 + ((rootPc(c.name) + this.pos - 4 + 12) % 12);        // E1..D#2
  }

  // ----- strokes from the strumming hand -----
  // start of a stroke: tells the band, records it, mutes strings not in the chord. Returns the chord or null.
  begin(id, dir, vel, t){
    if(this.band) this.band.onStroke(t);
    const c = this.current();
    if(!c){
      this.rec(t, { e: "stroke", id, d: dir, v: +vel.toFixed(3) });
      this.engine.chuck(dir, vel, t, id);
      return null;
    }
    if(c.name !== "open") this.lastChord = c.name;
    if(c.label !== this.lastLabel){ this.lastLabel = c.label; this.rec(t, { e: "chord", name: c.name, label: c.label }); }
    this.rec(t, { e: "stroke", id, d: dir, v: +vel.toFixed(3) });
    c.notes.forEach((m, s) => { if(m === null) this.engine.damp(s, t); });
    return c;
  }
  strokeStart({ id, dir, vel, center }){
    const t = this.ctx.currentTime + 0.003;
    const c = this.begin(id, dir, vel, t);
    if(!c){ this.strokes.set(id, null); return; }
    const order = strokeStrings(c.notes, dir, 6, center);
    this.strokes.set(id, { order, notes: c.notes, dir });
    if(this.strokes.size > 8) this.strokes.delete(this.strokes.keys().next().value);
    if(order.length) this.engine.note(order[0], c.notes[order[0]], t, vel * stringGain(dir, order[0]), { id });
  }
  strokeNext({ id, k, vel, delay }){
    const st = this.strokes.get(id); if(!st || k >= st.order.length) return;
    const s = st.order[k];
    this.engine.note(s, st.notes[s], this.ctx.currentTime + 0.003 + delay/1000, vel * stringGain(st.dir, s), { id });
  }

  // play one string directly (dragging across strings on screen, or the keyboard).
  // Strings crossed in one sweep count as one stroke.
  pluck(s, dir, vel){
    const now = this.ctx.currentTime, t = now + 0.003;
    let st = this.drag;
    if(!st || now - st.last > 0.15 || st.dir !== dir){
      const id = "p" + (this.pid = (this.pid || 0) + 1);
      st = this.drag = { id, dir, last: now, c: this.begin(id, dir, vel, t) };
    }
    st.last = now;
    if(!st.c) return;
    const m = st.c.notes[s]; if(m === null || m === undefined) return;
    this.engine.note(s, m, t, vel * stringGain(dir, s), { id: st.id });
  }
  // a whole stroke from the keyboard: count strings, like a swing of that size
  strum(dir, vel, count = 6){
    const id = "k" + (this.kid = (this.kid || 0) + 1), t = this.ctx.currentTime + 0.003;
    const c = this.begin(id, dir, vel, t); if(!c) return;
    const order = strokeStrings(c.notes, dir, count, null);
    order.forEach((s, k) => this.engine.note(s, c.notes[s], t + k*0.012, vel * stringGain(dir, s), { id }));
  }

  // hook a Motion engine straight in
  attach(motion){
    motion.cb = {
      onStrokeStart: e => this.strokeStart(e),
      onStrokeNext: e => this.strokeNext(e),
      onPads: p => this.setPads(p),
      onZone: z => this.setZone(z),
      onSlide: (dir, pos) => this.setPosition(pos)
    };
  }
}
// up-strokes catch the thin strings harder than the thick ones (and down-strokes the reverse, a little)
function stringGain(dir, s){ return dir < 0 ? (s < 2 ? 0.6 : 1) : (s > 3 ? 0.9 : 1); }
