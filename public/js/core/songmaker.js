// The three ways to publish a recording.
//   Rough   -> exactly as played
//   Enhance -> same playing, tighter timing, even loudness, studio sound
//   Song    -> your guitar exactly as played + AI singer, drums and bass around it

import { analyse, enhance, alignToBacking, songBrief } from "./performance.js";
import { guessKey } from "./chords.js";
import { detectBeats } from "./tempo.js";
import { api } from "./api.js";

export function rough(perf){ return { ...perf, studio: false }; }
export { enhance };

// onStep(text) reports progress for the UI. ctx = any AudioContext (for decoding the AI track).
export async function createSong(perf, { ctx, theme = "", onStep = () => {} } = {}){
  const an = analyse(perf);
  if(!an.tempo.bpm || an.tempo.confidence < 0.2) throw new Error("Strum with a steadier beat so the band can follow you");
  const brief = songBrief(perf, an);
  const firstChord = perf.events.find(e=>e.e==="chord")?.name || null;
  const key = guessKey(an.chordTime, firstChord);
  onStep("Writing lyrics and calling the band…");
  const res = await api.backing({ bpm: brief.bpm, durationMs: brief.durationMs, key, progression: brief.progression, voice: perf.voice, theme });
  onStep("Downloading the AI band…");
  const audio = await (await fetch(res.url)).arrayBuffer();
  const backing = await ctx.decodeAudioData(audio);
  onStep("Lining your guitar up with the beat…");
  const mono = backing.numberOfChannels > 1 ? mix(backing) : backing.getChannelData(0);
  const beats = detectBeats(mono, backing.sampleRate, brief.bpm);
  const song = alignToBacking(perf, an.tempo, beats, res.backingId);
  song.duration = Math.max(song.duration, backing.duration);
  return { performance: song, backingId: res.backingId, backing, lyrics: res.lyrics || "", key, bpm: beats.bpm };
}
function mix(buf){
  const a = buf.getChannelData(0), b = buf.getChannelData(1), out = new Float32Array(a.length);
  for(let i=0;i<a.length;i++) out[i] = (a[i]+b[i])*0.5;
  return out;
}
