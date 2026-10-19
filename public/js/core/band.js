// AI Band: listens to the strums, finds the tempo, comes in on the next downbeat and
// plays drums + bass that follow the chord. Stops when the player stops.

export class Band {
  // engine: AudioEngine. bassRoot(): midi of the chord root (or null). onBeat(t, downbeat). onState(state)
  constructor(engine, { bassRoot = () => null, onBeat = null, onState = null } = {}){
    this.engine = engine; this.bassRoot = bassRoot; this.onBeat = onBeat; this.onState = onState;
    this.on = false; this.state = "off"; this.hits = []; this.bpm = 0; this.off = 0;
    this.step = 0; this.nextT = 0; this.bar = 0; this.timer = null; this.lastHit = 0; this.waiting = false; this.ending = false;
  }
  get ctx(){ return this.engine.ctx; }
  setOn(on){
    this.on = on;
    if(on){ this.state = "listening"; this.hits = []; this.bpm = 0; }
    else { this.stop(); this.state = "off"; }
    this.changed();
  }
  changed(){ if(this.onState) this.onState(this.state, this.bpm); }
  stop(){ clearInterval(this.timer); this.timer = null; this.ending = false; this.waiting = false; }

  // call on every stroke (audio-clock time)
  onStroke(t){
    if(!this.on) return;
    if(this.hits.length && t - this.hits[this.hits.length-1] > 1.6) this.hits = [];
    this.hits.push(t); if(this.hits.length > 10) this.hits.shift();
    this.lastHit = t;
    if(this.state === "listening"){ const bpm = this.estimate(); if(bpm) this.start(bpm, t); return; }
    if(this.state === "playing"){
      this.ending = false;
      const e8 = 30/this.bpm;
      const ref = this.nextT - (this.step % 2 ? this.stepDur() : 0);
      let err = ((t - ref) % e8 + e8) % e8; if(err > e8/2) err -= e8;
      if(Math.abs(err) < e8*0.3){ this.nextT += err*0.3; this.off = 0; }
      else if(++this.off >= 3){ this.nextT += err; this.off = 0; }   // clearly on another beat: jump to the player
      const nb = this.estimate(true);
      if(nb){ let b = nb; while(b < this.bpm*0.7) b *= 2; while(b > this.bpm*1.4) b /= 2;
        if(Math.abs(b - this.bpm)/this.bpm < 0.25) this.bpm = this.bpm*0.8 + b*0.2; }
    }
  }
  estimate(relaxed){
    const h = this.hits; if(h.length < (relaxed ? 3 : 4)) return 0;
    const iv = []; for(let i=1;i<h.length;i++){ const d = h[i]-h[i-1]; if(d > 0.12 && d < 1.5) iv.push(d); }
    if(iv.length < (relaxed ? 2 : 3)) return 0;
    const recent = iv.slice(-6), med = [...recent].sort((a,b)=>a-b)[Math.floor(recent.length/2)];
    const ok = recent.filter(d => Math.abs(d-med)/med < 0.22 || Math.abs(d-2*med)/(2*med) < 0.22).length;
    if(ok < recent.length - (relaxed ? 1 : 0) || (ok < 3 && !relaxed)) return 0;
    let bpm = 30/med; while(bpm < 75) bpm *= 2; while(bpm > 170) bpm /= 2;
    return bpm;
  }
  stepDur(){ return 15/this.bpm; }
  start(bpm, t){
    this.bpm = bpm; this.state = "playing"; this.bar = 0; this.ending = false; this.waiting = true;
    this.step = 0; this.nextT = t;
    while(this.nextT < this.ctx.currentTime + 0.015){ this.nextT += this.stepDur(); this.step++; }
    clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 25);
    this.changed();
  }
  tick(){
    const now = this.ctx.currentTime;
    if(!this.ending && now - this.lastHit > Math.max(3, 8*60/this.bpm)) this.ending = true;
    while(this.nextT < now + 0.12){
      const s = this.step % 16;
      if(this.waiting){
        if(s !== 0){ if(s%4===0 && this.onBeat) this.onBeat(this.nextT, false); this.nextT += this.stepDur(); this.step++; continue; }
        this.waiting = false; this.engine.drum("crash", this.nextT, 0.7);
      }
      if(this.ending && s === 0){
        this.engine.drum("kick", this.nextT, 1); this.engine.drum("crash", this.nextT, 0.9);
        this.stop(); this.state = "listening"; this.hits = []; this.changed(); return;
      }
      if(s === 0) this.bar++;
      this.play(s, this.nextT);
      if(s % 4 === 0 && this.onBeat) this.onBeat(this.nextT, s === 0);
      this.nextT += this.stepDur(); this.step++;
    }
  }
  play(s, t){
    const E = this.engine, v = E.voice, root = this.bassRoot(), sd = this.stepDur();
    if(v === "metal"){
      E.drum("kick", t, s%4===0 ? 1 : 0.75, 1);
      if(s===4 || s===12) E.drum("snare", t, 1);
      if(s%4 === 0) E.drum("ride", t, 0.5);
      if(s===0 && this.bar%2===1) E.drum("crash", t, 0.7);
      if(root !== null) E.bass(root, t, sd*0.8, 0.9);
    } else if(v === "rock"){
      if(s===0 || s===6 || s===8) E.drum("kick", t, 1);
      if(s===4 || s===12) E.drum("snare", t, 1);
      if(s%2 === 0) E.drum(s===14 ? "open" : "hat", t, s%4===0 ? 0.55 : 0.35);
      if(s===0 && this.bar%4===1) E.drum("crash", t, 0.6);
      if(root !== null && s%2 === 0) E.bass(root + (s===6||s===14 ? 12 : 0), t, sd*1.7, 0.85);
    } else {
      if(s===0 || s===8 || s===10) E.drum("kick", t, 0.7);
      if(s===4 || s===12) E.drum("snare", t, 0.55, 1);
      if(s%2 === 0) E.drum("hat", t, 0.28);
      if(root !== null && (s===0 || s===8 || s===10)) E.bass(root, t, sd*(s===8 ? 2 : 3.5), 0.7);
    }
  }
}
