// One shared audio engine for listening to songs (lists + song page).
import { AudioEngine } from "../core/sound.js";
import { Player } from "../core/player.js";
import { api } from "../core/api.js";
import { toast } from "./common.js";

let ctx, engine, player, current = null, playTimer = null;
const listeners = new Set();
const cache = new Map();          // id -> {song, performance, backing?}

export function onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }
function emit(){ for(const f of listeners) f(current); }
export function nowPlaying(){ return current; }
export function position(){ return player ? player.position() : 0; }

function ensure(){
  if(!ctx){
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "playback" });
    engine = new AudioEngine(ctx, { sampleBase: "/samples/" });
  }
  if(ctx.state !== "running") ctx.resume();
}

export async function load(id){
  if(cache.has(id)) return cache.get(id);
  const data = await api.get(id);
  if(data.song.backing_url){
    ensure();
    const buf = await (await fetch(data.song.backing_url)).arrayBuffer();
    data.backing = await ctx.decodeAudioData(buf);
  }
  cache.set(id, data);
  return data;
}

// opts.onEvent(e) receives each event as it sounds (for chord display)
export async function toggle(id, { onEvent } = {}){
  ensure();
  if(current && current.id === id){ stop(); return false; }
  stop();
  current = { id, loading: true }; emit();
  try{
    const d = await load(id);
    if(!current || current.id !== id) return false;
    player = new Player(engine, { onEvent, onEnd: () => { current = null; emit(); } });
    await player.play(d.performance, { backing: d.backing || null });
    current = { id, loading: false, duration: d.performance.duration, song: d.song }; emit();
    clearTimeout(playTimer);
    playTimer = setTimeout(() => api.play(id).catch(() => {}), 3000);   // counts as a play after 3 s
    return true;
  } catch(e){
    current = null; emit(); toast(e.message || "Couldn't play that song", true); return false;
  }
}
export function stop(){
  clearTimeout(playTimer);
  if(player){ player.stop(); player = null; }
  if(current){ current = null; emit(); }
}

// likes remembered on this device so buttons show the right state
const LK = "airkords-liked";
export function likedSet(){ try { return new Set(JSON.parse(localStorage.getItem(LK) || "[]")); } catch(e){ return new Set(); } }
export async function like(id){
  const r = await api.like(id);
  try { const s = likedSet(); r.liked ? s.add(id) : s.delete(id); localStorage.setItem(LK, JSON.stringify([...s].slice(-500))); } catch(e){}
  return r;
}
