// Runs the Vercel version on this machine for testing: static files + the same API function.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { GET, POST } from "../api/index.js";
const PUB = path.resolve("public"), PORT = +(process.env.PORT || 8787);
const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".jpg":"image/jpeg", ".png":"image/png", ".mp3":"audio/mpeg", ".txt":"text/plain", ".json":"application/json" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if(u.pathname.startsWith("/api/") || /^\/song\/[^/]+\/?$/.test(u.pathname)){
      // same rewrite as vercel.json
      const dest = new URL("/api/index", u); u.searchParams.forEach((v,k)=>dest.searchParams.set(k,v)); dest.searchParams.set("__p", u.pathname.slice(1));
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = new Request(dest, { method: req.method, headers: req.headers, body: ["GET","HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const out = await (req.method === "POST" ? POST : GET)(r);
      res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer())); return;
    }
    let p = path.join(PUB, decodeURIComponent(u.pathname));
    if(!p.startsWith(PUB)) throw 0;
    let s = await stat(p).catch(() => null);
    if(s && s.isDirectory()){ p = path.join(p, "index.html"); s = await stat(p).catch(() => null); }
    if(!s){ p = p + ".html"; s = await stat(p).catch(() => null); }          // cleanUrls
    if(!s){ res.writeHead(404, { "content-type": TYPES[".html"] }); res.end(await readFile(path.join(PUB, "404.html"))); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" }); res.end(await readFile(p));
  } catch(e){ console.error(e); res.writeHead(500); res.end("error"); }
}).listen(PORT, "127.0.0.1", () => console.log("local vercel on " + PORT));
