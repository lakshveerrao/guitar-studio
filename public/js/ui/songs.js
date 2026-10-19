import { nav, footer, songRow, esc, toast, ICON, MODE_LABEL, VOICE_LABEL } from "./common.js";
import { api } from "../core/api.js";
import * as listen from "./listen.js";

nav("/songs"); footer();
const $ = (id) => document.getElementById(id);
let sort = "top", mode = "", offset = 0, loading = false;
const PAGE = 20;

async function load(reset){
  if(loading) return; loading = true;
  if(reset){ offset = 0; $("list").innerHTML = `<div class="empty">Loading songs…</div>`; $("podium").innerHTML = ""; }
  try{
    const { songs } = await api.list({ sort, limit: PAGE, offset, mode: mode || undefined });
    const liked = listen.likedSet();
    if(reset){
      $("list").innerHTML = "";
      if(!songs.length){ $("list").innerHTML = `<div class="empty">No songs here yet — <a href="/play#record" style="color:var(--brand);text-decoration:underline">record the first one</a>.</div>`; }
      // top 3 get a podium on the first page of "Top"
      if(sort === "top" && songs.length >= 3){
        $("podium").innerHTML = songs.slice(0, 3).map(s => `
          <div class="card pod" data-rank="${s.rank}" data-id="${esc(s.id)}">
            <span class="kicker" style="color:var(--brand)">#${s.rank}</span>
            <a class="pod__t" href="/song/${esc(s.id)}">${esc(s.title)}</a>
            <div class="row__meta" style="margin:0">${esc(s.nickname)} · <span class="badge badge--${esc(s.mode)}">${MODE_LABEL[s.mode]}</span><span class="badge badge--${esc(s.voice)}">${VOICE_LABEL[s.voice]}</span></div>
            <div class="pod__row"><button class="row__play" aria-label="Play ${esc(s.title)}">${ICON.play}</button>
              <button class="like" aria-pressed="${liked.has(s.id)}" aria-label="Like">${ICON.heart}<span>${s.likes}</span></button>
              <span class="row__stats">${s.plays} plays</span></div>
          </div>`).join("");
      }
    }
    const rest = (reset && sort === "top" && songs.length >= 3) ? songs.slice(3) : songs;
    $("list").insertAdjacentHTML("beforeend", rest.map(s => songRow(s, { rank: sort === "new" ? 0 : s.rank })).join(""));
    $("list").querySelectorAll(".row").forEach(r => r.querySelector(".like").setAttribute("aria-pressed", liked.has(r.dataset.id)));
    offset += songs.length;
    $("more").style.display = songs.length === PAGE ? "" : "none";
    paint(listen.nowPlaying());
  } catch(e){ $("list").innerHTML = `<div class="empty">Songs couldn't load right now. Try again in a moment.</div>`; }
  loading = false;
}

function group(id, attr, set){
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest(`[data-${attr}]`); if(!b) return;
    $(id).querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
    set(b.dataset[attr]); load(true);
  });
}
group("sort", "s", v => sort = v);
group("modes", "m", v => mode = v);
$("more").addEventListener("click", () => load(false));

document.querySelector("main").addEventListener("click", async (e) => {
  const item = e.target.closest("[data-id]"); if(!item) return;
  if(e.target.closest(".row__play")){ await listen.toggle(item.dataset.id); }
  else if(e.target.closest(".like")){
    const b = e.target.closest(".like");
    try {
      const r = await listen.like(item.dataset.id);
      document.querySelectorAll(`[data-id="${item.dataset.id}"] .like`).forEach(x => { x.setAttribute("aria-pressed", r.liked); x.querySelector("span").textContent = r.likes; });
    } catch(err){ toast(err.message, true); }
  }
});
function paint(cur){
  document.querySelectorAll("[data-id]").forEach(r => {
    const b = r.querySelector(".row__play"); if(!b) return;
    const on = cur && cur.id === r.dataset.id;
    b.classList.toggle("playing", !!on);
    b.innerHTML = on ? (cur.loading ? `<span style="font-size:11px;font-weight:800">…</span>` : ICON.pause) : ICON.play;
  });
}
listen.onChange(paint);
load(true);
