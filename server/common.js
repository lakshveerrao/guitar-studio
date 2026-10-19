// Shared by the Cloudflare Worker and the Vercel function: word filter, validation, and the ElevenLabs calls.
export const BLOCK = ["fuck","shit","bitch","cunt","dick","pussy","nigg","fag","slut","whore","rape","porn","sex","nazi","kill yourself","kys","asshole","bastard","retard"];
export function clean(s){ const t = String(s || "").toLowerCase().replace(/[^a-z ]/g, ""); return !BLOCK.some(w => t.includes(w)); }
export const NICK_RE = /^[\p{L}\p{N} _.-]{2,20}$/u;
export const VOTER_RE = /^[a-zA-Z0-9-]{16,64}$/;

// ---------- Create a song: AI singer + drums + bass around the player's guitar ----------
const STYLE = {
  acoustic: { genre: "acoustic pop", extra: ["warm", "uplifting", "acoustic drum kit", "soft bass"] },
  rock:     { genre: "rock", extra: ["energetic", "punchy live drums", "driving electric bass", "anthemic"] },
  metal:    { genre: "heavy metal", extra: ["powerful", "double kick drums", "heavy bass", "aggressive but clean vocals"] }
};
const NO_GUITAR = ["guitar", "acoustic guitar", "electric guitar", "distorted guitar", "guitar solo", "strummed guitar", "explicit lyrics"];

export function buildPrompt(b){
  const st = STYLE[b.voice] || STYLE.acoustic;
  const theme = b.theme ? ` The song is about ${b.theme}.` : "";
  return `A ${st.genre} song at ${b.bpm} BPM in ${b.key}, chord progression ${b.progression.join(" - ")}. `
       + `Only lead vocals, drums and bass guitar — absolutely no guitar of any kind, the guitar part is played separately. `
       + `Keep a steady ${b.bpm} BPM beat from the very first second with no tempo changes. `
       + `${st.extra.join(", ")}. Clean, family-friendly, positive lyrics that kids can sing.${theme}`;
}

// make the AI's plan exactly our length and tempo, and keep guitar out of it
export function shapePlan(plan, b){
  const st = STYLE[b.voice] || STYLE.acoustic;
  const pos = [`${b.bpm} BPM`, b.key, st.genre, ...st.extra, "lead vocals", "drums", "bass"];
  const total = b.durationMs;
  const fit = (durs) => {          // scale section lengths to the total, each 3s..120s
    const sum = durs.reduce((a, c) => a + c, 0) || 1;
    let out = durs.map(d => Math.max(3000, Math.min(120000, Math.round(d * total / sum))));
    out[out.length - 1] += total - out.reduce((a, c) => a + c, 0);
    if(out[out.length - 1] < 3000){ out = mergeLast(out); }
    return out;
  };
  if(Array.isArray(plan.chunks)){
    const d = fit(plan.chunks.map(c => c.duration_ms || 10000));
    return { kind: "chunks", plan: { chunks: plan.chunks.slice(0, d.length).map((c, i) => ({
      text: String(c.text || "").slice(0, 6000), duration_ms: d[i],
      positive_styles: uniq([...(i === 0 ? pos : [`${b.bpm} BPM`]), ...(c.positive_styles || [])]).slice(0, 50),
      negative_styles: uniq([...NO_GUITAR, ...(c.negative_styles || [])]).slice(0, 50),
      context_adherence: "high" })) } };
  }
  if(Array.isArray(plan.sections)){
    const d = fit(plan.sections.map(s => s.duration_ms || 10000));
    return { kind: "sections", plan: {
      positive_global_styles: uniq([...pos, ...(plan.positive_global_styles || [])]).slice(0, 50),
      negative_global_styles: uniq([...NO_GUITAR, ...(plan.negative_global_styles || [])]).slice(0, 50),
      sections: plan.sections.slice(0, d.length).map((s, i) => ({
        section_name: String(s.section_name || "Section").slice(0, 100),
        positive_local_styles: (s.positive_local_styles || []).filter(x => !/guitar/i.test(x)).slice(0, 50),
        negative_local_styles: uniq([...(s.negative_local_styles || []), "guitar"]).slice(0, 50),
        duration_ms: d[i], lines: (s.lines || []).slice(0, 30).map(l => String(l).slice(0, 200)) })) } };
  }
  return null;
}
function mergeLast(a){ while(a.length > 1 && a[a.length - 1] < 3000){ const x = a.pop(); a[a.length - 1] += x; } return a; }
const uniq = (a) => [...new Set(a.filter(Boolean).map(String))];
export function lyricsOf(plan){
  if(plan.sections) return plan.sections.map(s => (s.lines || []).length ? `[${s.section_name}]\n${s.lines.join("\n")}` : "").filter(Boolean).join("\n\n");
  if(plan.chunks) return plan.chunks.map(c => c.text).filter(Boolean).join("\n\n");
  return "";
}

export async function eleven(env, path, payload){
  const base = env.ELEVENLABS_BASE || "https://api.elevenlabs.io";
  return fetch(base + path, { method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json" }, body: JSON.stringify(payload) });
}
export async function failText(r){ let t = ""; try { t = await r.text(); } catch(e){} return `${r.status} ${t.slice(0, 300)}`; }

// plan (free) -> fix length/tempo/no-guitar -> compose. Falls back to a plain prompt if the plan route fails.
export async function compose(env, brief){
  const model = env.MUSIC_MODEL || "music_v1";
  const prompt = buildPrompt(brief);
  let lyrics = "";
  const pr = await eleven(env, "/v1/music/plan", { prompt, music_length_ms: brief.durationMs, model_id: model });
  if(pr.ok){
    const shaped = shapePlan(await pr.json(), brief);
    if(shaped){
      lyrics = lyricsOf(shaped.plan);
      const cr = await eleven(env, "/v1/music?output_format=mp3_44100_128", { composition_plan: shaped.plan, model_id: model, respect_sections_durations: true });
      if(cr.ok) return { audio: await cr.arrayBuffer(), type: cr.headers.get("content-type") || "audio/mpeg", lyrics, model };
      const why = await failText(cr);
      if(cr.status === 401 || cr.status === 402 || cr.status === 429) throw Object.assign(new Error(why), { userMessage: aiMessage(cr.status) });
      console.warn("plan compose failed, using prompt", why);
    }
  } else {
    const why = await failText(pr);
    if(pr.status === 401 || pr.status === 402) throw Object.assign(new Error(why), { userMessage: aiMessage(pr.status) });
  }
  const r = await eleven(env, "/v1/music?output_format=mp3_44100_128", { prompt, music_length_ms: brief.durationMs, model_id: model });
  if(!r.ok){ const why = await failText(r); throw Object.assign(new Error(why), { userMessage: aiMessage(r.status, why) }); }
  return { audio: await r.arrayBuffer(), type: r.headers.get("content-type") || "audio/mpeg", lyrics, model };
}
export function aiMessage(status, why = ""){
  if(status === 401) return "The AI key isn't working — ask the site owner to check it.";
  if(status === 402 || /quota|credit/i.test(why)) return "The AI band is out of credits for now.";
  if(status === 429) return "The AI band is busy — try again in a minute.";
  if(status === 400 || status === 422) return "The AI didn't like that song idea — try different words.";
  return "The AI couldn't make this song. Try again in a minute.";
}

