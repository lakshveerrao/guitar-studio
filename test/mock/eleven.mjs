// Fake ElevenLabs for local tests. Records requests; returns a plan and a WAV "song" with a beat.
import http from "node:http";
const log = [];
let mode = "ok";   // ok | composeplan422 | unauthorized
function wav(bpm, ms, intro=0.6){
  const sr = 22050, n = Math.floor(ms/1000*sr), x = new Int16Array(n);
  for(let b=0, t=intro; t < ms/1000 - 0.3; b++, t = intro + b*60/bpm){
    const i0 = Math.floor(t*sr), amp = b%4===0 ? 0.9 : 0.5;
    for(let i=0;i<sr*0.25 && i0+i<n;i++) x[i0+i] += Math.round(32767*0.5*amp*Math.sin(2*Math.PI*55*i/sr)*Math.exp(-i/(sr*0.07)));
  }
  const buf = Buffer.alloc(44 + n*2);
  buf.write("RIFF",0); buf.writeUInt32LE(36+n*2,4); buf.write("WAVE",8); buf.write("fmt ",12); buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20); buf.writeUInt16LE(1,22);
  buf.writeUInt32LE(sr,24); buf.writeUInt32LE(sr*2,28); buf.writeUInt16LE(2,32); buf.writeUInt16LE(16,34); buf.write("data",36); buf.writeUInt32LE(n*2,40);
  for(let i=0;i<n;i++) buf.writeInt16LE(x[i], 44+i*2);
  return buf;
}
http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    if(req.url === "/__log"){ res.end(JSON.stringify(log)); return; }
    if(req.url.startsWith("/__mode/")){ mode = req.url.slice(8); log.length = 0; res.end("ok"); return; }
    const j = body ? JSON.parse(body) : {};
    log.push({ url: req.url, key: req.headers["xi-api-key"], body: j });
    if(mode === "unauthorized"){ res.writeHead(401); res.end('{"detail":"invalid api key"}'); return; }
    if(req.url.startsWith("/v1/music/plan")){
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ positive_global_styles: ["pop"], negative_global_styles: [], sections: [
        { section_name: "Verse", positive_local_styles: ["acoustic guitar strumming", "soft"], negative_local_styles: [], duration_ms: 12000, lines: ["Air guitar in my hands", "playing loud"] },
        { section_name: "Chorus", positive_local_styles: ["big"], negative_local_styles: [], duration_ms: 12000, lines: ["We rock the sky"] } ] }));
      return;
    }
    if(req.url.startsWith("/v1/music")){
      if(mode === "composeplan422" && j.composition_plan){ res.writeHead(422); res.end('{"detail":[{"msg":"bad plan"}]}'); return; }
      const styles = j.composition_plan ? j.composition_plan.positive_global_styles.join(" ") : j.prompt;
      const bpm = +(/(\d+) BPM/.exec(styles) || [0,120])[1];
      const ms = j.composition_plan ? j.composition_plan.sections.reduce((a,s)=>a+s.duration_ms,0) : j.music_length_ms;
      res.setHeader("content-type", "audio/wav"); res.end(wav(bpm*1.004, ms));   // tiny tempo error like a real model
      return;
    }
    res.writeHead(404); res.end();
  });
}).listen(9099, "127.0.0.1", () => console.log("mock eleven on 9099"));
