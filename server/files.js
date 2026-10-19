// Where recordings and AI audio live: Vercel Blob on Vercel, a local folder when testing.
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const LOCAL = path.resolve(process.env.LOCAL_FILES || ".localfiles");
const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
export const mode = () => useBlob() ? "blob" : "local";

let blob = null;
async function B(){ return blob ||= await import("@vercel/blob"); }

// store a file; returns the key used to read it back
export async function put(key, data, contentType){
  if(useBlob()){
    const { put } = await B();
    const r = await put(key, typeof data === "string" ? data : Buffer.from(data), { access: "public", contentType, addRandomSuffix: false, allowOverwrite: true });
    return r.url;
  }
  const f = path.join(LOCAL, key); await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, typeof data === "string" ? data : Buffer.from(data));
  await writeFile(f + ".type", contentType || "application/octet-stream");
  return key;
}
async function blobUrl(key){
  const { head } = await B();
  try { return (await head(key)).url; } catch(e){ return null; }
}
export async function get(key){
  if(useBlob()){
    const url = await blobUrl(key); if(!url) return null;
    const r = await fetch(url); if(!r.ok) return null;
    return { body: r.body, type: r.headers.get("content-type") };
  }
  try { const f = path.join(LOCAL, key); return { body: await readFile(f), type: await readFile(f + ".type", "utf8") }; } catch(e){ return null; }
}
export async function getJSON(key){
  const f = await get(key); if(!f) return null;
  return JSON.parse(f.body instanceof ReadableStream ? await new Response(f.body).text() : f.body.toString("utf8"));
}
export async function del(key){
  if(useBlob()){ const { del } = await B(); const url = await blobUrl(key); if(url) await del(url); return; }
  await rm(path.join(LOCAL, key), { force: true });
}
// read one of the site's own static pages (song.html) for the song page
export async function staticText(name, url){
  try { return await readFile(path.join(process.cwd(), "public", name), "utf8"); }
  catch(e){ const r = await fetch(new URL("/" + name.replace(/\.html$/, ""), url)); return r.text(); }
}
