// Tempo + beat helpers (pure JS, no audio APIs).

// Find the tempo of a list of strum times (seconds). Strums are treated as 8th notes.
// Returns {bpm, beat0, confidence 0..1}. beat0 = time of a beat (the grid's phase).
export function estimateTempo(times, {min=70, max=180} = {}){
  if(times.length < 4) return {bpm:0, beat0:0, confidence:0};
  let best = {score:-1};
  for(let bpm=min; bpm<=max; bpm+=0.25){
    const p = 30/bpm;                       // 8th-note period
    let c=0, s=0;
    for(const t of times){ const a = 2*Math.PI*t/p; c+=Math.cos(a); s+=Math.sin(a); }
    const R = Math.hypot(c,s)/times.length;
    // mild preference for the comfortable middle, so ties don't drift to the edges
    const score = R - 0.02*Math.abs(Math.log2(bpm/120));
    if(score > best.score){ const ph = Math.atan2(s,c); best = {score, R, bpm, beat0: ((ph/(2*Math.PI))*p + p) % p}; }
  }
  // refine: average gap between strums that land on neighbouring grid points
  return {bpm: best.bpm, beat0: best.beat0, confidence: best.R};
}

// Local beat grid around time t, so players who speed up or slow down are followed.
// Searches tempo within ±20% of the global one using only the strums near t.
// Returns {p8, phase}: 8th-note period and grid phase at that spot.
export function localGrid(times, t, globalBpm, globalPhase, win=2.5){
  const near = []; for(const x of times){ const d=Math.abs(x-t); if(d<=win) near.push([x, 1-d/win]); }
  const gp = 30/globalBpm;
  if(near.length < 5) return {p8: gp, phase: globalPhase};
  const fit = (p) => { let c=0, s=0, n=0;
    for(const [x,w] of near){ const a=2*Math.PI*(x-t)/p; c+=w*Math.cos(a); s+=w*Math.sin(a); n+=w; }
    return {R: Math.hypot(c,s)/n, p8:p, phase: t + ((Math.atan2(s,c)/(2*Math.PI))*p)}; };
  const steady = fit(gp);
  let best = steady;
  for(let f=0.8; f<=1.25; f+=0.005){ const g = fit(gp*f); if(g.R > best.R) best = g; }
  // Only move away from the overall grid when the player has clearly drifted:
  // the local shift must be bigger than the noise in the local estimate.
  const wrap = (d,p) => ((d % p) + 1.5*p) % p - 0.5*p;
  const shift = wrap(steady.phase - globalPhase, gp);
  const n = near.reduce((a,[,w])=>a+w, 0);
  const sd = gp/(2*Math.PI) * Math.sqrt(Math.max(0, -2*Math.log(Math.max(1e-6, steady.R))));
  const noise = sd/Math.sqrt(n);
  if(best.R - steady.R > 0.08) return best;                 // tempo itself has changed here
  if(Math.abs(shift) > 3*noise + 0.004) return steady;       // same tempo, but the player is ahead/behind
  return {p8: gp, phase: globalPhase};                       // steady player: use the whole-song grid
}

// Beat tracking on audio (e.g. the AI backing track). samples = mono Float32Array.
// Returns {bpm, beat0, downbeat0} near the expected tempo.
export function detectBeats(samples, sampleRate, bpmHint){
  // onset envelope at 100 frames/s from the rise in energy (kick + snare + everything)
  const hop = Math.round(sampleRate/100), nF = Math.floor(samples.length/hop);
  const env = new Float32Array(nF), low = new Float32Array(nF);
  let lp = 0;
  const kLow = 1 - Math.exp(-2*Math.PI*150/sampleRate);   // ~150 Hz low-pass for the kick
  for(let f=0; f<nF; f++){
    let e=0, el=0;
    for(let i=f*hop; i<(f+1)*hop; i++){ const x=samples[i]; e+=x*x; lp += kLow*(x-lp); el+=lp*lp; }
    env[f] = Math.log(1e-6 + e); low[f] = Math.log(1e-6 + el);
  }
  const onset = new Float32Array(nF), kick = new Float32Array(nF);
  for(let f=1; f<nF; f++){ onset[f] = Math.max(0, env[f]-env[f-1]); kick[f] = Math.max(0, low[f]-low[f-1]); }
  // tempo: try the hint and its half/double, ±8%
  let best = {score:-1};
  for(const mul of [1, 2, 0.5]){
    for(let bpm=bpmHint*mul*0.92; bpm<=bpmHint*mul*1.08; bpm+=0.1){
      if(bpm < 60 || bpm > 200) continue;
      const per = 6000/bpm;               // frames per beat
      // best phase for this tempo
      for(let ph=0; ph<per; ph+=0.5){
        let sc=0, n=0;
        for(let x=ph; x<nF-1; x+=per){ const i=Math.round(x); sc += onset[i] + 0.5*(onset[i-1]||0) + 0.5*(onset[i+1]||0); n++; }
        sc /= Math.max(1,n);
        const score = sc * (mul===1 ? 1 : 0.85);
        if(score > best.score) best = {score, bpm, ph, per};
      }
    }
  }
  if(best.score < 0) return {bpm:bpmHint, beat0:0, downbeat0:0};
  // downbeat: which of the 4 beats in a bar has the strongest kick
  // (kick onset + kick loudness, each beat window ±30 ms, summed over every bar)
  const bars=[0,0,0,0];
  let k=0; for(let x=best.ph; x<nF-3; x+=best.per, k++){
    const i=Math.round(x); let on=0, lv=-1e9;
    for(let j=Math.max(0,i-3); j<=Math.min(nF-1,i+3); j++){ on = Math.max(on, kick[j]); lv = Math.max(lv, low[j]); }
    bars[k%4] += on + 0.5*lv;
  }
  const d = bars.indexOf(Math.max(...bars));
  const beat0 = best.ph/100;
  return {bpm: best.bpm, beat0, downbeat0: beat0 + d*60/best.bpm};
}

// map a time from one beat grid to another (keeps the position inside the beat)
export function remapTime(t, from, to){
  const beats = (t - from.beat0) * from.bpm/60;
  return to.beat0 + beats * 60/to.bpm;
}
