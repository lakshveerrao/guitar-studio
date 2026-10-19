// AirKords motion engine — turns raw remote packets into musical actions.
// No DOM and no audio here, so it runs (and is tested) anywhere.
//
// FRET remote (left hand), like a real fretting hand:
//   • tilt the neck front/back (up/down)   -> chord row  (up / level / down)
//   • slide the hand left/right along neck -> move up/down the neck (chords shift by frets, strings glide)
//   • optional: twist the wrist            -> chord column (left / center / right)  [off by default]
//   • touch pads 1-3                        -> which chord in the row
// STRUM remote (right hand):
//   • swing                                 -> strum; small flick = 1-2 strings, full swing = all 6
//   • optional pick mode: hand height       -> which string the stroke is centred on
// With only one remote connected, it does pads + tilt + strum (no slide, no pick mode).

export const GYRO_LSB = 65.5;    // MPU6050 at ±500 °/s
export const ACC_LSB = 16384;    // MPU6050 at ±2 g

export const MOTION_DEFAULTS = {
  // strum
  strumAxis: 5, strumInv: false, strumThr: 150,   // gyro axis (3,4,5 = X,Y,Z), °/s threshold
  fullStrumDeg: 60,                                // a swing this big crosses all 6 strings
  pickMode: false, pickAxis: 1, pickInv: false, pickRangeDeg: 30,
  // fret: tilt rows
  tiltAxis: 1, tiltInv: false, tiltAng: 22,
  // fret: twist columns (optional)
  twist: false, twistAxis: 0, twistInv: false, twistAng: 25,
  // fret: slide along the neck
  slide: true, neckAxis: 0, neckInv: false, slideThr: 0.5, slideStep: 2, slideMax: 12,
  // per-remote calibration
  base: { fret: [0,0,0], strum: [0,0,0] },     // tilt angles when held "level"
  bias: { fret: [0,0,0], strum: [0,0,0] }      // resting gyro readings
};

export function tiltFromRaw(raw, axis){
  const mag = Math.hypot(raw[0], raw[1], raw[2]) || 1;
  return Math.asin(Math.max(-1, Math.min(1, raw[axis]/mag))) * 180/Math.PI;
}

// 15-byte BLE packet from the firmware -> {pads, capOk, raw[6]}
export function parsePacket(dv){
  if(dv.byteLength < 14 || dv.getUint8(0) !== 0xA1) return null;
  const b1 = dv.getUint8(1), raw = [];
  for(let i=0;i<6;i++) raw.push(dv.getInt16(2+i*2, true));
  return { pads: b1 & 7, capOk: !!(b1 & 0x80), raw };
}

function newDev(){ return { have:false, pads:0, capOk:false, raw:[0,0,0,0,0,0], last:0 }; }

export class Motion {
  // cb: { onStrokeStart({id,dir,vel,center,t}), onStrokeNext({id,k,vel,delay}), onStrokeEnd({id,count,dir,t}),
  //       onStrum(dir, vel, count) [after each stroke], onSlide(dir, pos, t), onZone(zone), onPads(pads) }
  constructor(settings = {}, cb = {}){
    this.S = Object.assign(JSON.parse(JSON.stringify(MOTION_DEFAULTS)), settings);
    this.cb = cb;
    this.devs = { fret:newDev(), strum:newDev() };
    this.zone = { row:"level", col:"center" };
    this.tilt = 0; this.twistDeg = 0; this.pos = 0; this.hand = 0;
    this.rate = 0;
    this.sw = { phase:"armed", dir:0, peak:0, angle:0, k:0, max:6, id:0, lastDir:0, lastFire:-1e9 };
    this.sl = { lp:null, lockUntil:0, quietSince:0 };
    this.lastT = { fret:0, strum:0 };
  }

  tiltSrc(){ return this.devs.fret.have ? "fret" : this.devs.strum.have ? "strum" : null; }
  strumSrc(){ return this.devs.strum.have ? "strum" : this.devs.fret.have ? "fret" : null; }
  bothConnected(){ return this.devs.fret.have && this.devs.strum.have; }
  pads(){ return this.devs.fret.pads | this.devs.strum.pads; }
  disconnect(role){ this.devs[role] = newDev(); this.sl.lp = null; }

  // feed one packet. now = ms timestamp (performance.now() in the app)
  feed(role, pkt, now){
    const d = this.devs[role];
    const prevPads = this.pads();
    d.have = true; d.pads = pkt.pads; d.capOk = pkt.capOk; d.raw = pkt.raw; d.last = now;
    const dt = Math.max(4, Math.min(50, this.lastT[role] ? now - this.lastT[role] : 16)) / 1000;
    this.lastT[role] = now;
    if(this.pads() !== prevPads && this.cb.onPads) this.cb.onPads(this.pads());

    if(role === this.strumSrc()){
      const g = (d.raw[this.S.strumAxis] - this.S.bias[role][this.S.strumAxis-3]) / GYRO_LSB;
      this.rate = g * (this.S.strumInv ? -1 : 1);
      if(this.S.pickMode && this.bothConnected()){
        let h = tiltFromRaw(d.raw, this.S.pickAxis) - this.S.base[role][this.S.pickAxis];
        if(this.S.pickInv) h = -h;
        this.hand = h;
      }
    }
    if(role === this.tiltSrc()){
      this.updateZone(d, role);
      if(this.S.slide && role==="fret" && this.bothConnected()) this.detectSlide(d, role, now, dt);
    }
    if(role === this.strumSrc()) this.detectStrum(now, dt);
  }

  // ---- front/back tilt -> rows, twist -> columns (with hysteresis) ----
  updateZone(d, role){
    const S = this.S;
    let t = tiltFromRaw(d.raw, S.tiltAxis) - S.base[role][S.tiltAxis];
    if(S.tiltInv) t = -t;
    this.tilt = t;
    // one remote doing everything wobbles while strumming: hold the zone mid-strum
    if(role === this.strumSrc() && Math.abs(this.rate) > S.strumThr*0.5) return;
    const old = this.zone.row + "/" + this.zone.col;
    this.zone.row = zoneStep(this.zone.row, t, S.tiltAng, ["down","level","up"]);
    if(S.twist){
      let w = tiltFromRaw(d.raw, S.twistAxis) - S.base[role][S.twistAxis];
      if(S.twistInv) w = -w;
      this.twistDeg = w;
      this.zone.col = zoneStep(this.zone.col, w, S.twistAng, ["left","center","right"]);
    } else this.zone.col = "center";
    if(old !== this.zone.row + "/" + this.zone.col && this.cb.onZone) this.cb.onZone({...this.zone});
  }

  // ---- left/right slide along the neck ----
  // Gravity is removed with a slow low-pass; a quick slide shows up as a short burst of
  // acceleration along the neck. Rotations (tilts) are ignored because the gyro sees them.
  detectSlide(d, role, now, dt){
    const S = this.S, a = [d.raw[0]/ACC_LSB, d.raw[1]/ACC_LSB, d.raw[2]/ACC_LSB];
    const sl = this.sl;
    if(!sl.lp){ sl.lp = a.slice(); sl.quietSince = now; return; }
    const k = 1 - Math.exp(-dt/0.35);
    const hp = a.map((v,i)=> v - sl.lp[i]);
    for(let i=0;i<3;i++) sl.lp[i] += (a[i]-sl.lp[i])*k;
    const b = S.bias[role];
    const gyro = Math.hypot(d.raw[3]-b[0], d.raw[4]-b[1], d.raw[5]-b[2]) / GYRO_LSB;
    if(gyro > 80) sl.quietSince = now;              // still rotating (a tilt), not a slide
    if(now < sl.lockUntil || now - sl.quietSince < 450) return;
    const ax = S.neckAxis;
    const along = hp[ax] * (S.neckInv ? -1 : 1);
    const across = Math.hypot(...hp.filter((_,i)=>i!==ax));
    if(Math.abs(along) > S.slideThr && Math.abs(along) > 1.4*across){
      const dir = along > 0 ? 1 : -1;     // +1 = towards the guitar body = higher notes
      const np = Math.max(0, Math.min(S.slideMax, this.pos + dir*S.slideStep));
      sl.lockUntil = now + 420;           // skip the braking bump at the end of the slide
      if(np !== this.pos){ this.pos = np; if(this.cb.onSlide) this.cb.onSlide(dir, np, now); }
    }
  }
  setPosition(p){ this.pos = Math.max(0, Math.min(this.S.slideMax, p)); }

  // ---- strum: like a real pick crossing the strings ----
  // The first string sounds the moment the swing passes the threshold (no waiting).
  // Each further string sounds when the hand has travelled another string-width (fullStrumDeg/6),
  // so a small flick plays 1-2 strings, a full swing plays all 6, and the gap between strings
  // comes from how fast the hand really moves. Strings crossed between two packets are spread
  // out in time (delay) so a very fast strum still sounds smooth.
  detectStrum(now, dt){
    const S = this.S, sw = this.sw, r = this.rate, a = Math.abs(r), dir = r > 0 ? 1 : -1, thr = S.strumThr;
    const step = S.fullStrumDeg / 6;
    if(sw.phase === "stroke"){
      const ended = dir !== sw.dir || a < Math.max(thr*0.5, sw.peak*0.45);
      if(!ended){
        const before = sw.angle;
        sw.angle += a*dt; if(a > sw.peak) sw.peak = a;
        const vel = velOf(a, thr);
        while(sw.k < sw.max && sw.angle >= sw.k*step){
          // when, inside this packet's 16 ms, did the hand reach this string?
          const frac = Math.max(0, Math.min(1, (sw.k*step - before) / Math.max(1e-6, sw.angle - before)));
          // keep the real spacing between strings: play it frac of a packet from now
          if(this.cb.onStrokeNext) this.cb.onStrokeNext({ id: sw.id, k: sw.k, vel, delay: frac * dt * 1000 });
          sw.k++;
        }
        return;
      }
      this.endStroke(now);
      // fall through: a reversal can start the next stroke right away
    }
    const fresh = sw.phase === "armed" || (sw.phase === "fired" && dir !== sw.lastDir);
    if(a > thr && fresh && !(now - sw.lastFire < 60 && dir === sw.lastDir)){
      let center = null;
      if(S.pickMode && this.bothConnected()){
        const h = Math.max(-S.pickRangeDeg, Math.min(S.pickRangeDeg, this.hand));
        center = (S.pickRangeDeg - h) / (2*S.pickRangeDeg) * 5;   // hand high = low E, hand low = high E
      }
      sw.phase = "stroke"; sw.dir = dir; sw.peak = a; sw.angle = 0; sw.k = 1; sw.max = 6;
      sw.id = (sw.id||0) + 1; sw.lastDir = dir; sw.lastFire = now;
      const vel = velOf(a, thr);
      if(this.cb.onStrokeStart) this.cb.onStrokeStart({ id: sw.id, dir, vel, center, t: now });
      return;
    }
    if(sw.phase === "fired" && a < thr*0.4) sw.phase = "armed";
  }
  endStroke(now){
    const sw = this.sw;
    sw.phase = "fired";
    if(this.cb.onStrokeEnd) this.cb.onStrokeEnd({ id: sw.id, count: sw.k, dir: sw.dir, t: now });
    if(this.cb.onStrum) this.cb.onStrum(sw.dir, velOf(sw.peak, this.S.strumThr), sw.k, null, now);
  }
}

function velOf(rate, thr){ return Math.max(0.15, Math.min(1, (rate - thr) / (thr*2.2) + 0.3)); }

function zoneStep(cur, v, T, [neg, mid, pos]){
  const H = 5;
  if(cur === mid){ if(v > T) return pos; if(v < -T) return neg; return mid; }
  if(cur === pos){ if(v < T-H) return v < -T ? neg : mid; return pos; }
  if(v > -T+H) return v > T ? pos : mid;
  return neg;
}

// ---- auto setup: works out how each remote is mounted ----
// Steps: "still" (hold both still) -> "strum" (swing the strum remote) ->
//        "tilt" (tilt the neck up) -> "slide" (slide the fret hand along the neck, towards the body)
export class Calibrator {
  constructor(motion){ this.m = motion; this.samples = { fret:[], strum:[] }; }
  add(role, raw){ this.samples[role].push(raw.slice()); }
  reset(){ this.samples = { fret:[], strum:[] }; }
  avg(rows){ const a=[0,0,0,0,0,0]; rows.forEach(r=>r.forEach((v,i)=>a[i]+=v/rows.length)); return a; }
  finish(step){
    const S = this.m.S, m = this.m, out = {ok:true};
    if(step === "still"){
      for(const r of ["fret","strum"]){
        const sm = this.samples[r]; if(!sm.length) continue;
        const avg = this.avg(sm);
        S.bias[r] = [avg[3], avg[4], avg[5]];
        S.base[r] = [0,1,2].map(ax=>tiltFromRaw(avg, ax));
      }
    } else if(step === "strum"){
      const r = m.strumSrc(), e=[0,0,0];
      this.samples[r].forEach(row=>{ for(let k=0;k<3;k++){ const v=row[3+k]-S.bias[r][k]; e[k]+=v*v; } });
      S.strumAxis = 3 + e.indexOf(Math.max(...e));
      out.strumAxis = S.strumAxis;
    } else if(step === "tilt"){
      const r = m.tiltSrc(), sm = this.samples[r];
      const avg = this.avg(sm.slice(Math.floor(sm.length/2)));
      let best=0, bestD=0;
      for(let ax=0;ax<3;ax++){ const d=tiltFromRaw(avg,ax)-S.base[r][ax]; if(Math.abs(d)>Math.abs(bestD)){bestD=d;best=ax;} }
      if(Math.abs(bestD) < 8) out.ok = false;
      else { S.tiltAxis = best; S.tiltInv = bestD < 0; out.tiltAxis = best; }
    } else if(step === "slide"){
      const sm = this.samples.fret; if(sm.length < 10){ out.ok=false; return out; }
      const g = this.avg(sm);                    // gravity ≈ the average over the step
      const e=[0,0,0], first=[0,0,0];
      for(const row of sm) for(let k=0;k<3;k++){
        const v = (row[k]-g[k])/ACC_LSB; e[k]+=v*v;
        if(!first[k] && Math.abs(v) > 0.35) first[k] = Math.sign(v);
      }
      const ax = e.indexOf(Math.max(...e));
      if(Math.sqrt(e[ax]/sm.length) < 0.08 || !first[ax]) out.ok = false;
      else {
        S.neckAxis = ax;
        S.neckInv = first[ax] < 0;   // first push was towards the body, which is "+"
        // tilt and twist must use other axes than the neck axis
        if(S.twistAxis === ax) S.twistAxis = [0,1,2].find(i=>i!==ax && i!==S.tiltAxis);
        out.neckAxis = ax;
      }
    }
    this.reset();
    return out;
  }
}
