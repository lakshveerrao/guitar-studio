// Talking to airkords.com. No accounts: each device gets a random player id (kept in the browser),
// and players only ever show a nickname.

export function playerId(){
  const make = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,"0")).join(""));
  try {
    let id = localStorage.getItem("airkords-player");
    if(!id || !/^[a-zA-Z0-9-]{16,64}$/.test(id)){ id = make(); localStorage.setItem("airkords-player", id); }
    return id;
  } catch(e){ return (playerId.mem ||= make()); }
}

async function call(path, { method = "GET", body } = {}){
  const r = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch(e){}
  if(!r.ok) throw Object.assign(new Error((data && data.error) || `Request failed (${r.status})`), { status: r.status });
  return data;
}

export const api = {
  list: ({ sort = "top", limit = 20, offset = 0, mode } = {}) =>
    call(`/api/songs?sort=${sort}&limit=${limit}&offset=${offset}${mode ? "&mode=" + mode : ""}`),
  get: (id) => call(`/api/songs/${id}?voter=${playerId()}`),
  publish: ({ nickname, title, mode, performance, backingId }) =>
    call("/api/songs", { method: "POST", body: { voter: playerId(), nickname, title, mode, performance, backingId } }),
  like: (id) => call(`/api/songs/${id}/like`, { method: "POST", body: { voter: playerId() } }),
  play: (id) => call(`/api/songs/${id}/play`, { method: "POST", body: { voter: playerId() } }),
  report: (id, reason) => call(`/api/songs/${id}/report`, { method: "POST", body: { voter: playerId(), reason } }),
  backing: (brief) => call("/api/ai/backing", { method: "POST", body: { voter: playerId(), ...brief } }),
  health: () => call("/api/health")
};
