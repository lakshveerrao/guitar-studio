// Chords, voicings and music helpers shared by the app, the player and the server.

export const OPEN = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4 (string 0 = low E)

// fret shapes, low E -> high E. x = muted
export const CHORDS = {
  "G":"320003","C":"x32010","D":"xx0232","Em":"022000","Am":"x02210","E":"022100",
  "A":"x02220","Dm":"xx0231","F":"xx3211","Bm":"x24432","B7":"x21202","D7":"xx0212",
  "G7":"320001","A7":"x02020","E7":"020100","C7":"x32310","Cmaj7":"x32000","Fmaj7":"xx3210",
  "Am7":"x02010","Em7":"022030","Asus2":"x02200","Dsus4":"xx0233","Esus4":"022200"
};

const SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const PC = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};

export function rootPc(name){
  const m = /^([A-G])([#b]?)/.exec(name); if(!m) return 0;
  let p = PC[m[1]]; if(m[2]==="#") p++; if(m[2]==="b") p--;
  return (p+12)%12;
}
export function quality(name){ return name.replace(/^[A-G][#b]?/, ""); }
export function transposeName(name, semis){
  if(!semis || name==="open") return name;
  return SHARP[(rootPc(name)+semis%12+12)%12] + quality(name);
}

// What gets played for a chord. voice = acoustic | rock | metal, pos = semitones up the neck.
// Returns {label, shape: [fret|null x6], notes: [midi|null x6]}.
export function voicing(name, voice="acoustic", pos=0){
  if(!name) return null;
  if(name==="open"){
    const shape=[0,0,0,0,0,0].map(f=>f+pos);
    return {label: pos ? "open+"+pos : "open", shape, notes: OPEN.map(n=>n+pos)};
  }
  if(!CHORDS[name]) return null;
  if(voice==="metal"){       // power chord: root, fifth, octave
    const pc = (rootPc(name)+pos)%12;
    let f = (pc-4+12)%12, shape;
    if(f<=7) shape=[f,f+2,f+2,null,null,null];
    else { f=(pc-9+12)%12; shape=[null,f,f+2,f+2,null,null]; }
    return {label: SHARP[pc]+"5", shape, notes: shape.map((v,i)=>v===null?null:OPEN[i]+v)};
  }
  const shape = CHORDS[name].split("").map(c=> c==="x" ? null : +c+pos);
  return {label: transposeName(name,pos), shape, notes: shape.map((v,i)=>v===null?null:OPEN[i]+v)};
}

// Which strings a stroke hits.
// dir +1 = down stroke (starts on the low E side), -1 = up stroke (starts on the high E side).
// count = 1..6 strings. center = optional string 0..5 the hand is over (pick mode).
// Only strings that are part of the chord count: muted strings are skipped over, like a real hand.
export function strokeStrings(notes, dir, count, center=null){
  const live = [0,1,2,3,4,5].filter(i=>notes[i]!==null && notes[i]!==undefined);
  if(!live.length) return [];
  count = Math.max(1, Math.min(live.length, Math.round(count)));
  let start;
  if(center===null || center===undefined){
    start = dir>0 ? 0 : live.length-count;
  } else {
    // the live string nearest to where the hand is, then grow the window around it
    let near=0, best=99;
    live.forEach((s,k)=>{ const d=Math.abs(s-center); if(d<best){best=d; near=k;} });
    start = Math.round(near - (count-1)/2);
    start = Math.max(0, Math.min(live.length-count, start));
  }
  const sel = live.slice(start, start+count);
  return dir>0 ? sel : sel.reverse();
}

// Key of a song from its chords, the way a musician would guess it:
// 1) keep the keys that the most chords belong to, 2) prefer the key whose home chord is
// played the most, 3) the first chord breaks ties (songs usually start at home).
const MAJOR_DEGREES = [[0,"maj"],[2,"min"],[4,"min"],[5,"maj"],[7,"maj"],[9,"min"],[11,"dim"]];
const MINOR_DEGREES = [[0,"min"],[2,"dim"],[3,"maj"],[5,"min"],[7,"min"],[7,"maj"],[8,"maj"],[10,"maj"]];
function chordKind(name){
  const q = quality(name);
  if(/^m(?!aj)/.test(q)) return "min";
  if(/^dim/.test(q)) return "dim";
  if(/^sus/.test(q) || /sus/.test(q)) return "any";
  return "maj";
}
export function guessKey(chordWeights, firstChord = null){
  const items = Object.entries(chordWeights).filter(([n,w]) => CHORDS[n] && w > 0);
  if(!items.length) return "C major";
  const total = items.reduce((a,[,w]) => a+w, 0);
  const cands = [];
  for(let t=0;t<12;t++) for(const [deg, mode] of [[MAJOR_DEGREES,"major"],[MINOR_DEGREES,"minor"]]){
    let fit = 0;
    for(const [n,w] of items){
      const r = (rootPc(n)-t+12)%12, k = chordKind(n);
      if(deg.some(([d,q]) => d===r && (k==="any" || q===k))) fit += w;
    }
    const tonicKind = mode==="major" ? "maj" : "min";
    const home = items.filter(([n]) => rootPc(n)===t && (chordKind(n)===tonicKind)).reduce((a,[,w])=>a+w, 0);
    const first = firstChord && CHORDS[firstChord] && rootPc(firstChord)===t && chordKind(firstChord)===tonicKind ? 1 : 0;
    cands.push({ key: SHARP[t]+" "+mode, score: (fit/total)*100 + (home/total)*10 + first*2 + (mode==="major" ? 0.1 : 0) });
  }
  return cands.reduce((a,b) => b.score > a.score ? b : a).key;
}
