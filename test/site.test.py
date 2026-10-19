"""End-to-end tests against the local site (wrangler dev on :8787 + fake ElevenLabs on :9099)."""
import asyncio, json, urllib.request
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8787"
R = {}
def check(name, ok, info=None): R[name] = (bool(ok), info)
def mock(path): return urllib.request.urlopen("http://127.0.0.1:9099" + path).read().decode()

MODS = """async () => { window.AK = {
  perf: await import('/js/core/performance.js'), api: await import('/js/core/api.js'),
  song: await import('/js/core/songmaker.js'), player: await import('/js/core/player.js'),
  chords: await import('/js/core/chords.js') };
  // a fake 12 s performance: 8th-note strums at 118 BPM, G C D Em, a bit sloppy
  window.fakePerf = (voice='rock', bpm=118, secs=12) => { const r = new AK.perf.Recorder(); r.start(0, voice);
    const p8=30/bpm, prog=['G','C','D','Em']; let id=0;
    for(let k=0, t=0.4; t<secs; k++, t=0.4+k*p8){ const tt=t+(Math.random()*2-1)*0.02, name=prog[Math.floor(k/8)%4];
      if(k%8===0) r.push(tt-0.005, {e:'chord', name, label:name});
      const c=AK.chords.voicing(name, voice), d=k%2?-1:1; id++; r.push(tt,{e:'stroke',id,d,v:0.7});
      AK.chords.strokeStrings(c.notes, d, 4).forEach((s,j)=>r.push(tt+j*0.01,{e:'note',s,m:c.notes[s],v:0.7,id})); }
    return r.stop(secs); };
  return true; }"""

async def post(pg, path, body):
    return await pg.evaluate("""async ([p, b]) => { const r = await fetch(p, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(b)});
      return {status: r.status, data: await r.json().catch(()=>null)}; }""", [path, body])

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(BASE + "/"); await pg.evaluate(MODS)
        check("homepage served", "AirKords" in await pg.content())
        check("samples served from the site", (await pg.evaluate("fetch('/samples/acoustic_guitar_steel/40.mp3').then(r=>r.status)")) == 200)

        # --- publish Rough + Enhanced ---
        r = await pg.evaluate("""async () => { const perf = fakePerf('rock');
          const a = await AK.api.api.publish({nickname:'Laksh', title:'First jam', mode:'rough', performance: AK.song.rough(perf)});
          const e = await AK.api.api.publish({nickname:'Laksh', title:'First jam (enhanced)', mode:'enhanced', performance: AK.song.enhance(perf)});
          const ga = await AK.api.api.get(a.id), ge = await AK.api.api.get(e.id);
          return {a, e, ga: ga.song, perfA: ga.performance.events.length, studioE: ge.performance.studio, bpmE: ge.song.bpm, same: JSON.stringify(ga.performance.events)===JSON.stringify(perf.events)}; }""")
        check("publish Rough: stored exactly as played", r["same"] and r["ga"]["mode"] == "rough", r["ga"])
        check("publish Enhanced: studio on, tempo found", r["studioE"] is True and abs(r["bpmE"]-118) < 2, (r["studioE"], r["bpmE"]))
        ids = [r["a"]["id"], r["e"]["id"]]
        check("song page link returned", r["a"]["url"] == "/song/" + ids[0])
        check("player id and IP are never sent back", "voter" not in r["ga"] and "ip_hash" not in r["ga"])

        # --- validation & safety ---
        perf = await pg.evaluate("fakePerf('acoustic')")
        bad = await post(pg, "/api/songs", {"voter":"x"*20, "nickname":"a", "title":"t", "mode":"rough", "performance": perf})
        check("short nickname rejected", bad["status"] == 400, bad)
        bad = await post(pg, "/api/songs", {"voter":"x"*20, "nickname":"shithead", "title":"t", "mode":"rough", "performance": perf})
        check("rude nickname rejected", bad["status"] == 400, bad)
        bad = await post(pg, "/api/songs", {"voter":"x"*20, "nickname":"Sam", "title":"t", "mode":"rough", "performance": {**perf, "events":[{"t":1,"e":"evil"}]}})
        check("fake recording rejected", bad["status"] == 400, bad)
        bad = await post(pg, "/api/songs", {"voter":"x"*20, "nickname":"Sam", "title":"t", "mode":"song", "performance": perf, "backingId":"aaaaaaaaaaaa"})
        check("AI song needs a real AI backing", bad["status"] == 400, bad)

        # --- likes, plays, leaderboard ---
        v = [f"voter-{i:02d}-abcdefghijkl" for i in range(5)]
        for i in range(3): await post(pg, f"/api/songs/{ids[1]}/like", {"voter": v[i]})
        r1 = await post(pg, f"/api/songs/{ids[0]}/like", {"voter": v[0]})
        r2 = await post(pg, f"/api/songs/{ids[0]}/like", {"voter": v[0]})
        check("like toggles on/off", r1["data"]["liked"] and r1["data"]["likes"] == 1 and not r2["data"]["liked"] and r2["data"]["likes"] == 0, (r1, r2))
        for i in range(4): await post(pg, f"/api/songs/{ids[0]}/play", {"voter": v[0]})
        r3 = await post(pg, f"/api/songs/{ids[0]}/play", {"voter": v[1]})
        check("plays count once per listener per day", r3["data"]["plays"] == 2, r3)
        top = await pg.evaluate("AK.api.api.list({sort:'top'})")
        new = await pg.evaluate("AK.api.api.list({sort:'new'})")
        plays = await pg.evaluate("AK.api.api.list({sort:'plays'})")
        check("leaderboard 'top' uses likes + plays", top["songs"][0]["id"] == ids[1] and top["songs"][0]["rank"] == 1, [(s["id"], s["likes"], s["plays"]) for s in top["songs"]])
        check("'plays' and 'new' sorting", plays["songs"][0]["id"] == ids[0] and new["songs"][0]["id"] == ids[1], None)

        # --- Create a song with the (fake) AI ---
        mock("/__mode/ok")
        r = await pg.evaluate("""async () => { const perf = fakePerf('rock', 118, 12); const ctx = new OfflineAudioContext(1, 44100, 44100);
          const steps=[]; const s = await AK.song.createSong(perf, {ctx, theme:'flying a kite', onStep: t=>steps.push(t)});
          const pub = await AK.api.api.publish({nickname:'Laksh', title:'Kite Song', mode:'song', performance: s.performance, backingId: s.backingId});
          const got = await AK.api.api.get(pub.id);
          // where do strums land relative to the fake band's beats (intro 0.6 s, 118*1.004 BPM)?
          const bp = 118*1.004, p8 = 30/bp;
          const off = got.performance.events.filter(e=>e.e==='stroke').map(e=>{ const k=Math.round((e.t-0.6)/p8); return Math.abs(e.t-0.6-k*p8)*1000; });
          const first = got.performance.events.find(e=>e.e==='stroke').t;
          const notesKept = JSON.stringify(got.performance.events.filter(e=>e.e==='note').map(e=>[e.s,e.m])) === JSON.stringify(perf.events.filter(e=>e.e==='note').map(e=>[e.s,e.m]));
          const buf = await AK.player.renderOffline(got.performance, {sampleRate: 22050, backing: s.backing});
          let rms=0; const d=buf.getChannelData(0); for(const x of d) rms+=x*x;
          return {steps, lyrics: s.lyrics, key: s.key, song: got.song, maxOff: Math.max(...off), meanOff: off.reduce((a,b)=>a+b,0)/off.length, first, notesKept, rms: Math.sqrt(rms/d.length)}; }""")
        check("Create a song: AI backing made, song published", r["song"]["mode"] == "song" and r["song"]["backing_url"], r["song"])
        check("lyrics come back with the song", "Air guitar" in r["lyrics"] and "Air guitar" in (r["song"]["lyrics"] or ""), r["lyrics"][:80])
        check("guitar notes kept exactly as played", r["notesKept"])
        check("guitar strums line up with the AI beat (< 15 ms)", r["meanOff"] < 15 and r["maxOff"] < 50, (round(r["meanOff"],1), round(r["maxOff"],1)))
        check("first strum lands on the band's first downbeat", abs(r["first"] - 0.6) < 0.03, r["first"])
        check("song + backing render to audio", r["rms"] > 0.01, r["rms"])
        log = json.loads(mock("/__log"))
        plan_req, comp_req = log[0], log[1]
        cp = comp_req["body"]["composition_plan"]
        check("API key sent to ElevenLabs only from the server", plan_req["key"] == "test-key" and comp_req["key"] == "test-key")
        check("AI told: no guitar, right tempo + key", "guitar" in cp["negative_global_styles"] and "118 BPM" in cp["positive_global_styles"] and "G major" in cp["positive_global_styles"], cp["positive_global_styles"])
        check("AI's own guitar ideas removed", not any("guitar" in s for sec in cp["sections"] for s in sec["positive_local_styles"]))
        bars = json.loads(json.dumps(plan_req["body"]))["music_length_ms"]
        check("song length = whole bars at the player's tempo", sum(s["duration_ms"] for s in cp["sections"]) == bars and abs(bars/(240000/118) - round(bars/(240000/118))) < 0.01, bars)
        check("kid-safe lyrics requested", "family-friendly" in plan_req["body"]["prompt"] and "flying a kite" in plan_req["body"]["prompt"])
        again = await post(pg, "/api/songs", {"voter": await pg.evaluate("AK.api.playerId()"), "nickname":"Laksh", "title":"Again", "mode":"song", "performance": perf, "backingId": log and r["song"]["backing_url"].split("/")[-1]})
        check("an AI track can only be published once", again["status"] == 400, again)

        # --- fallbacks + errors ---
        mock("/__mode/composeplan422")
        r = await pg.evaluate("""async () => { const perf = fakePerf('metal', 140, 10); const ctx = new OfflineAudioContext(1, 44100, 44100);
          try { const s = await AK.song.createSong(perf, {ctx}); return {ok:true, id:s.backingId}; } catch(e){ return {ok:false, msg:e.message}; } }""")
        log = json.loads(mock("/__log"))
        check("if the AI rejects the plan, a plain prompt still works", r["ok"] and log[-1]["body"].get("prompt") and log[-1]["body"]["music_length_ms"], r)
        mock("/__mode/unauthorized")
        before = await pg.evaluate("fetch('/api/health').then(r=>r.json())")
        r = await pg.evaluate("""async () => { try { await AK.song.createSong(fakePerf('rock'), {ctx: new OfflineAudioContext(1,44100,44100)}); return 'no error'; } catch(e){ return e.message; } }""")
        check("bad API key -> friendly message", "key isn't working" in r, r)
        mock("/__mode/ok")
        # limits: 3 per person per day (2 used OK + failures refunded) -> 3rd works, 4th refused
        r3 = await pg.evaluate("""async () => { try { await AK.song.createSong(fakePerf('acoustic'), {ctx: new OfflineAudioContext(1,44100,44100)}); return 'ok'; } catch(e){ return e.message; } }""")
        r4 = await pg.evaluate("""async () => { try { await AK.song.createSong(fakePerf('acoustic'), {ctx: new OfflineAudioContext(1,44100,44100)}); return 'ok'; } catch(e){ return e.message; } }""")
        check("failed AI tries don't use up the daily limit", r3 == "ok", r3)
        check("daily AI limit per person", "today" in r4, r4)
        bad = await post(pg, "/api/ai/backing", {"voter": "z"*20, "bpm": 120, "durationMs": 20000, "voice": "rock", "key": "C major", "progression": ["C"], "theme": "go fuck yourself"})
        check("rude song idea rejected before reaching the AI", bad["status"] == 400, bad)

        # --- reports hide a song after 3 different people ---
        for i in range(3): await post(pg, f"/api/songs/{ids[0]}/report", {"voter": v[i], "reason": "test"})
        g = await pg.evaluate(f"fetch('/api/songs/{ids[0]}').then(r=>r.status)")
        lst = await pg.evaluate("AK.api.api.list({sort:'new', limit:50})")
        check("3 reports hide the song", g == 404 and ids[0] not in [s["id"] for s in lst["songs"]], g)
        # admin can bring it back
        r = await pg.evaluate(f"""fetch('/api/admin/songs/{ids[0]}', {{method:'POST', headers:{{authorization:'Bearer admin-token-1234567890','content-type':'application/json'}}, body: JSON.stringify({{action:'unhide'}})}}).then(r=>r.status)""")
        r2 = await pg.evaluate(f"""fetch('/api/admin/songs/{ids[0]}', {{method:'POST', headers:{{authorization:'Bearer wrong-token-000000000','content-type':'application/json'}}, body: JSON.stringify({{action:'delete'}})}}).then(r=>r.status)""")
        g = await pg.evaluate(f"fetch('/api/songs/{ids[0]}').then(r=>r.status)")
        check("owner token can un-hide; wrong token refused", r == 200 and r2 == 401 and g == 200, (r, r2, g))
        big = await pg.evaluate("""fetch('/api/songs', {method:'POST', headers:{'content-type':'application/json'}, body: 'x'.repeat(1200000)}).then(r=>r.status)""")
        check("oversized uploads refused", big == 413, big)
        check("no page errors", not errs, errs[:3])
        await b.close()
    ok = sum(1 for v in R.values() if v[0])
    for k,(o,i) in R.items(): print(("PASS " if o else "FAIL ")+k+("" if o else f"  -> {str(i)[:300]}"))
    print(f"\n{ok} passed, {len(R)-ok} failed")

asyncio.run(main())
