// Shared bits for every page: nav, footer, toast, formatting, reveal-on-scroll.

const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="#2a1700" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/><path d="M9 4v16" opacity=".55"/></svg>`;
const BURGER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;
const LINKS = [["/play","Play"],["/songs","Songs"],["/#how","How it works"],["/#story","Story"]];

export function nav(active){
  const el = document.querySelector("[data-nav]"); if(!el) return;
  const links = LINKS.map(([h,t]) => `<a href="${h}"${active===h ? ' aria-current="page"' : ""}>${t}</a>`).join("");
  el.innerHTML = `<nav class="nav" aria-label="Main"><div class="wrap nav__in">
      <a class="brand" href="/" aria-label="AirKords home"><span class="brand__mark">${LOGO}</span><span>Air<b>Kords</b></span></a>
      <div class="nav__links">${links}</div>
      <div class="nav__right">
        <a class="btn btn--brand btn--sm" href="/play">Start playing</a>
        <button class="burger" aria-label="Menu" aria-expanded="false">${BURGER}</button>
      </div></div>
      <div class="mnav" id="mnav">${links}</div></nav>`;
  const b = el.querySelector(".burger"), m = el.querySelector(".mnav");
  b.addEventListener("click", () => { const o = m.classList.toggle("open"); b.setAttribute("aria-expanded", o); });
  const n = el.querySelector(".nav");
  const onScroll = () => n.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
}

export function footer(){
  const el = document.querySelector("[data-foot]"); if(!el) return;
  el.innerHTML = `<footer class="foot"><div class="wrap">
    <div class="foot__in">
      <a class="brand" href="/"><span class="brand__mark">${LOGO}</span><span>Air<b>Kords</b></span></a>
      <div class="foot__links"><a href="/play">Play</a><a href="/songs">Songs</a><a href="/#how">How it works</a><a href="/#story">Story</a><a href="https://airomote.com" rel="noopener">AiroMote</a></div>
    </div>
    <small>Built by Lakshveer Rao. A working prototype under active development. Guitar and bass sounds are real recorded notes from the
    <a href="https://github.com/gleitz/midi-js-soundfonts" rel="noopener">FluidR3 GM</a> collection by Frank Wen, used under
    <a href="https://creativecommons.org/licenses/by/3.0/" rel="noopener">CC BY 3.0</a>. AI songs are made with ElevenLabs. Players only ever appear by nickname.</small>
  </div></footer>`;
}

let toastT;
export function toast(msg, bad){
  let t = document.querySelector(".toast");
  if(!t){ t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.classList.toggle("toast--bad", !!bad);
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), bad ? 4200 : 2600);
}

export function reveal(){
  const els = document.querySelectorAll(".reveal");
  if(!("IntersectionObserver" in window)){ els.forEach(e => e.classList.add("in")); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
  els.forEach(e => io.observe(e));
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
export const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s/60) + ":" + String(s%60).padStart(2, "0"); };
export const ago = (ms) => {
  const s = (Date.now() - ms)/1000;
  if(s < 60) return "just now"; if(s < 3600) return Math.floor(s/60) + "m ago";
  if(s < 86400) return Math.floor(s/3600) + "h ago"; if(s < 86400*30) return Math.floor(s/86400) + "d ago";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
export const MODE_LABEL = { rough: "Rough", enhanced: "Enhanced", song: "AI song" };
export const VOICE_LABEL = { acoustic: "Acoustic", rock: "Rock", metal: "Heavy Metal" };

export const ICON = {
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.9 1.3-1.8 2.9-2.9 4.9-2.9 3.5 0 5.6 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>`,
  plays: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 5.5v13l10-6.5z" stroke-linejoin="round"/></svg>`
};

export function songRow(s, { rank } = {}){
  return `<div class="row" data-id="${esc(s.id)}">
    <div class="row__rank${rank <= 3 ? " top" : ""}">${rank ? "#" + rank : ""}</div>
    <button class="row__play" aria-label="Play ${esc(s.title)}">${ICON.play}</button>
    <a class="row__main" href="/song/${esc(s.id)}">
      <div class="row__title">${esc(s.title)}</div>
      <div class="row__meta"><span>${esc(s.nickname)}</span>·<span class="badge badge--${esc(s.mode)}">${MODE_LABEL[s.mode] || ""}</span><span class="badge badge--${esc(s.voice)}">${VOICE_LABEL[s.voice] || ""}</span><span>${ago(s.created_at)}</span></div>
    </a>
    <div class="row__stats"><button class="like" aria-pressed="false" aria-label="Like">${ICON.heart}<span>${s.likes}</span></button><span title="Plays">${ICON.plays.replace("<svg", '<svg width="14" height="14" style="vertical-align:-2px"')} ${s.plays}</span></div>
  </div>`;
}
