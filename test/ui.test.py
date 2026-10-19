"""Click-through test of the whole site (needs test/serve.sh running)."""
import asyncio, re, urllib.request, json, math
from playwright.async_api import async_playwright
BASE = "http://127.0.0.1:8787"
R = {}
def check(name, ok, info=None): R[name] = (bool(ok), info)

PKT = """(role, pads, acc, gyro) => { const b = new DataView(new ArrayBuffer(15)); b.setUint8(0,0xA1); b.setUint8(1, pads | (role==='fret'?0x80:0));
  const v=[...acc.map(x=>Math.round(x*16384)), ...gyro.map(x=>Math.round(x*65.5))]; for(let i=0;i<6;i++) b.setInt16(2+i*2, Math.max(-32768,Math.min(32767,v[i])), true);
  window.__ak.onPacket(role, b); }"""

async def run(pg, frames):
    await pg.evaluate("""async (frames) => { const pk = """ + PKT + """;
      for(const f of frames){ if(f.fret) pk('fret', ...f.fret); if(f.strum) pk('strum', ...f.strum); await new Promise(r=>setTimeout(r,16)); } }""", frames)

def hold(n, fp=0, facc=(0,0,1), sacc=(0,0,1)): return [{"fret":[fp, list(facc), [0,0,0]], "strum":[0, list(sacc), [0,0,0]]} for _ in range(n)]
def swing(peak, n, fp=0, facc=(0,0,1)): return [{"fret":[fp, list(facc), [0,0,0]], "strum":[0,[0,0,1],[0,0,peak*math.sin(math.pi*i/(n-1))]]} for i in range(n)]

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = await b.new_context(viewport={"width":1280,"height":900})
        errs = []
        def watch(pg): pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type=="error" and "ERR_TUNNEL" not in m.text else None)

        # ---------- home ----------
        pg = await ctx.new_page(); watch(pg)
        await pg.goto(BASE + "/"); await pg.wait_for_timeout(800)
        await pg.locator("#neck").scroll_into_view_if_needed(); await pg.wait_for_timeout(900)
        box = await pg.locator("#neck").bounding_box()
        await pg.mouse.move(box["x"]+300, box["y"]+5); await pg.mouse.down()
        for i in range(1, 25): await pg.mouse.move(box["x"]+300, box["y"]+5+i*(box["height"]-10)/24); await pg.wait_for_timeout(8)
        await pg.mouse.up(); await pg.wait_for_timeout(50)
        rung = await pg.evaluate("document.querySelectorAll('#neck .str.ring').length")
        check("home: dragging across strings plays them", rung >= 5, rung)
        await pg.click("#tryChords [data-c=C]")
        off = await pg.evaluate("[...document.querySelectorAll('#neck .str')].map(e=>e.classList.contains('off'))")
        check("home: C chord mutes the low E string", off[0] and not any(off[1:]), off)
        await pg.click(".voice[data-voice=metal] .btn")
        try: await pg.wait_for_function("document.querySelector('.voice[data-voice=metal]').classList.contains('playing')", timeout=8000); ok = True
        except Exception: ok = False
        check("home: 'Hear it' plays a riff", ok)
        await pg.click(".voice[data-voice=metal] .btn")
        await pg.close()

        # ---------- play: remotes, motion, record, publish ----------
        pg = await ctx.new_page(); watch(pg)
        await pg.goto(BASE + "/play"); await pg.wait_for_timeout(600)
        await pg.evaluate("window.__ak.ensureAudio()")
        await run(pg, hold(10, 1))
        await pg.wait_for_timeout(100)
        check("play: fret pad 1 shows G", (await pg.inner_text("#chord")) == "G", await pg.inner_text("#chord"))
        await run(pg, hold(12, 1, (0, math.sin(math.radians(35)), math.cos(math.radians(35)))))
        await pg.wait_for_timeout(100)
        check("play: tilt neck up shows Em row", (await pg.inner_text("#chord")) == "Em" and await pg.evaluate("document.querySelector('.zone[data-zone=up]').classList.contains('on')"), await pg.inner_text("#chord"))
        await run(pg, hold(12, 2))
        await pg.evaluate("window.__notes=0; const o=window.__ak.engine.onEvent; window.__ak.engine.onEvent=(t,e)=>{ if(e.e==='note') window.__notes++; o(t,e); }; true")
        await run(pg, swing(380, 16, 2) + hold(10, 2))
        check("play: full swing on strum remote plays the C chord strings", await pg.evaluate("window.__notes") == 5, await pg.evaluate("window.__notes"))
        # slide along the neck (fret remote accel burst along X)
        sl = [{"fret":[2,[0.9*math.sin(2*math.pi*i/13),0,1],[0,0,0]], "strum":[0,[0,0,1],[0,0,0]]} for i in range(14)]
        await run(pg, hold(40, 2) + sl + hold(30, 2))
        check("play: sliding the fret remote moves up the neck (C -> D)", (await pg.inner_text("#chord")) == "D" and "+2" in await pg.inner_text("#posTxt"), (await pg.inner_text("#chord"), await pg.inner_text("#posTxt")))
        await pg.keyboard.press("ArrowLeft"); await pg.wait_for_timeout(80)
        check("play: ← slides back down", "Open" in await pg.inner_text("#posTxt"))
        # sound + band
        await pg.click("#voiceSeg [data-v=metal]"); await pg.wait_for_timeout(80)
        check("play: metal shows power chord", (await pg.inner_text("#chord")) == "C5", await pg.inner_text("#chord"))
        await pg.click("#voiceSeg [data-v=rock]")
        await pg.click("#btnBand")
        # record a steady 8-second jam with the keyboard (Space every 0.25 s), changing chords
        await pg.click("#btnRec")
        for k in range(32):
            pad = ["1","2","3","1"][(k//8)%4]
            await pg.keyboard.down(pad); await pg.keyboard.press(" " if k%2==0 else "u"); await pg.keyboard.up(pad)
            await pg.wait_for_timeout(240)
        band_state = await pg.evaluate("window.__ak.band.state")
        check("play: AI band locks on to steady strumming", band_state == "playing", band_state)
        await pg.click("#btnRec"); await pg.wait_for_timeout(300)
        check("play: stopping opens the publish sheet", await pg.evaluate("document.getElementById('dlgPub').open"))
        # listen to enhanced
        await pg.click("[data-listen=enhanced]"); await pg.wait_for_timeout(700)
        check("publish: enhanced preview plays", await pg.evaluate("document.querySelector('[data-listen=enhanced]').classList.contains('on')"))
        await pg.click("[data-listen=enhanced]")
        # AI song
        await pg.click(".opt[data-mode=song]")
        await pg.fill("#theme", "my cat dancing")
        await pg.click("#btnMake")
        await pg.wait_for_function("document.getElementById('aiResult').style.display===''", timeout=60000)
        check("publish: AI song made, lyrics shown", "Air guitar" in await pg.inner_text("#lyrics"), await pg.inner_text("#lyrics"))
        await pg.fill("#nick", "x")
        await pg.click("#btnPublish"); await pg.wait_for_timeout(300)
        check("publish: short nickname blocked", await pg.evaluate("document.getElementById('pubDone').style.display==='none'"))
        await pg.fill("#nick", "Laksh"); await pg.fill("#title", "Cat Dance")
        await pg.click("#btnPublish")
        await pg.wait_for_function("document.getElementById('pubDone').style.display===''", timeout=20000)
        song_url = await pg.input_value("#shareUrl")
        check("publish: done screen with share link", re.search(r"/song/[a-z0-9]{10}$", song_url), song_url)
        await pg.screenshot(path="/tmp/ak-ui-published.png")
        await pg.close()

        # seed a few more songs through the API so the charts have content
        def post(path, body):
            req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={"content-type":"application/json"}, method="POST")
            return json.loads(urllib.request.urlopen(req).read())
        song_id = song_url.rsplit("/",1)[1]
        perf = json.loads(urllib.request.urlopen(BASE + f"/api/songs/{song_id}").read())["performance"]
        rough = {**perf, "backing": None}; rough.pop("backing")
        ids = []
        for i,(nick,title,mode) in enumerate([("RiffKid","Sunny Strums","rough"),("Meera","Rainy Day Blues","enhanced"),("Arjun","Metal Monkey","enhanced"),("Zoe","Campfire","rough")]):
            r = post("/api/songs", {"voter": f"seed-voter-{i:02d}-abcdefgh", "nickname": nick, "title": title, "mode": mode, "performance": {**rough, "voice": ["acoustic","rock","metal","acoustic"][i], "studio": mode=="enhanced"}})
            ids.append(r["id"])
        for v in range(4): post(f"/api/songs/{song_id}/like", {"voter": f"liker-{v:02d}-abcdefghijk"})
        for v in range(2): post(f"/api/songs/{ids[2]}/like", {"voter": f"liker-{v:02d}-abcdefghijk"})

        # ---------- songs page ----------
        pg = await ctx.new_page(); watch(pg)
        await pg.goto(BASE + "/songs"); await pg.wait_for_selector(".pod .pod__t", timeout=8000)
        pod = await pg.evaluate("[...document.querySelectorAll('.pod .pod__t')].map(e=>e.textContent)")
        check("songs: podium shows top 3, most-liked first", len(pod) == 3 and pod[0] == "Cat Dance" and pod[1] == "Metal Monkey", pod)
        rows = await pg.evaluate("document.querySelectorAll('#list .row').length")
        check("songs: the rest listed below", rows == 2, rows)
        await pg.click(".pod .row__play"); await pg.wait_for_timeout(1500)
        check("songs: play button plays (shows pause)", await pg.evaluate("document.querySelector('.pod .row__play').classList.contains('playing')"))
        await pg.click(".pod .row__play")
        await pg.click("#modes [data-m=rough]")
        await pg.wait_for_function("document.querySelectorAll('#list .row').length === 2 && !document.querySelector('.pod')", timeout=8000)
        titles = await pg.evaluate("[...document.querySelectorAll('.row__title,.pod__t')].map(e=>e.textContent)")
        check("songs: Rough filter", sorted(titles) == ["Campfire","Sunny Strums"], titles)
        await pg.click("#modes [data-m='']"); await pg.wait_for_timeout(400); await pg.click("#sort [data-s=new]")
        await pg.wait_for_function("document.querySelectorAll('#list .row').length === 5", timeout=8000)
        first = await pg.evaluate("document.querySelector('.row__title').textContent")
        check("songs: New sort puts the latest first", first == "Campfire", first)
        lk = pg.locator(".row .like").first
        before = int(await lk.locator("span").inner_text()); await lk.click()
        await pg.wait_for_function("document.querySelector('.row .like').getAttribute('aria-pressed')==='true'", timeout=5000)
        after = int(await lk.locator("span").inner_text())
        check("songs: like button adds a like", after == before + 1 and await lk.get_attribute("aria-pressed") == "true", (before, after))
        await pg.screenshot(path="/tmp/ak-ui-songs.png", full_page=True)
        await pg.close()

        # ---------- song page ----------
        html = urllib.request.urlopen(BASE + f"/song/{song_id}").read().decode()
        check("song page: title + link preview set on the server", "<title>Cat Dance by Laksh — AirKords</title>" in html and 'og:title" content="Cat Dance by Laksh' in html, re.search(r"<title>.*?</title>", html).group(0))
        pg = await ctx.new_page(); watch(pg)
        await pg.goto(BASE + f"/song/{song_id}"); await pg.wait_for_timeout(1200)
        check("song page: lyrics for AI song", "Air guitar" in await pg.inner_text(".lyrics"))
        await pg.click("#play")
        try: await pg.wait_for_function("parseFloat(document.getElementById('bar').style.width) > 2", timeout=15000)
        except Exception: pass
        w = await pg.evaluate("parseFloat(document.getElementById('bar').style.width)")
        check("song page: playing moves the progress bar", w > 2, w)
        await pg.screenshot(path="/tmp/ak-ui-song.png", full_page=True)
        await pg.click("#play")
        await pg.close()
        try: urllib.request.urlopen(BASE + "/song/zzzzzzzzzz"); code = 200
        except urllib.error.HTTPError as e: code = e.code
        check("song page: unknown song gives 404", code == 404, code)
        try: urllib.request.urlopen(BASE + "/no-such-page"); code = 200
        except urllib.error.HTTPError as e: code = e.code
        check("404 page for unknown paths", code == 404, code)

        # phone screenshots
        m = await b.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True)
        for path, name in [("/songs","songs"), (f"/song/{song_id}","song")]:
            pg = await m.new_page(); watch(pg); await pg.goto(BASE + path); await pg.wait_for_timeout(1200)
            ov = await pg.evaluate("document.documentElement.scrollWidth - innerWidth")
            check(f"phone: {name} has no sideways scroll", ov == 0, ov)
            await pg.screenshot(path=f"/tmp/ak-ui-{name}-phone.png", full_page=True); await pg.close()
        check("no page errors", not errs, errs[:4])
        await b.close()
    ok = sum(1 for v in R.values() if v[0])
    for k,(o,i) in R.items(): print(("PASS " if o else "FAIL ")+k+("" if o else f"  -> {str(i)[:240]}"))
    print(f"\n{ok} passed, {len(R)-ok} failed")
asyncio.run(main())
