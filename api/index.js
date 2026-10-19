// Vercel Function: every /api/* request and /song/:id page comes here (see vercel.json).
import { handle } from "../server/app.js";

// vercel.json rewrites pass the original path as ?__p= ; put it back so routing sees the real URL
function original(req){
  const u = new URL(req.url);
  const p = u.searchParams.get("__p");
  if(p === null) return req;
  u.searchParams.delete("__p");
  u.pathname = "/" + p.replace(/^\/+/, "");
  return new Request(u, { method: req.method, headers: req.headers, body: ["GET","HEAD"].includes(req.method) ? undefined : req.body, duplex: "half" });
}
export async function GET(req){ return handle(original(req)); }
export async function POST(req){ return handle(original(req)); }
