"""Browser tests for the sound engine, instrument, recording, enhance and playback."""
import asyncio, os, subprocess, tempfile, time, json, math, sys
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 44100

def serve():
    d = tempfile.mkdtemp()
    os.symlink(f"{ROOT}/public/js", f"{d}/js"); os.symlink(f"{ROOT}/public/samples", f"{d}/samples")
    os.symlink(f"{ROOT}/test/pages/harness.html", f"{d}/harness.html")
    p = subprocess.Popen([sys.executable, "-m", "http.server", "8765", "-d", d], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8); return p

R = {}
def check(name, ok, info=None): R[name] = (bool(ok), info)

# pitch (Hz) of a mono segment by autocorrelation
PITCH_JS = """(d, sr, lo, hi) => { let best=0, bl=0; const N=Math.min(d.length-Math.ceil(sr/lo)-2, 8192);
  for(let lag=Math.floor(sr/hi); lag<=Math.ceil(sr/lo); lag++){ let s=0; for(let i=0;i<N;i++) s+=d[i]*d[i+lag]; if(s>best){best=s;bl=lag;} }
  const ac=l=>{let s=0;for(let i=0;i<N;i++) s+=d[i]*d[i+l]; return s;}; const a=ac(bl-1),b=ac(bl),c=ac(bl+1);
  return sr/(bl+0.5*(a-c)/(a-2*b+c)); }"""

async def main():
    srv = serve()
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            pg = await b.new_page()
            errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
            await pg.goto("http://127.0.0.1:8765/harness.html"); await pg.wait_for_function("window.ready")
            await pg.evaluate("window.pitch = " + PITCH_JS + "; true")

            # 1. samples load, trimmed, right pitch (A2 = 110 Hz on the 5th string open)
            r = await pg.evaluate("""async () => { const off = new OfflineAudioContext(2, 44100*2, 44100);
              const E = new AK.sound.AudioEngine(off, {sampleBase:'/samples/'}); await E.load(['acoustic','electric','bass']);
              const n = Object.keys(E.samples.acoustic).length + Object.keys(E.samples.electric).length + Object.keys(E.samples.bass).length;
              const s = E.samples.acoustic[45]; const d = s.buf.getChannelData(0); const st = Math.floor((s.offset+0.3)*s.buf.sampleRate);
              return {n, offset: s.offset, hz: pitch(d.subarray(st, st+12000), s.buf.sampleRate, 60, 400)}; }""")
            check("131 real samples load", r["n"] == 131, r["n"]); check("leading silence trimmed", 0 < r["offset"] < 0.2, r["offset"])
            check("A string sample is A2 (110 Hz)", abs(r["hz"]-110) < 2, round(r["hz"],1))

            # 2. motion -> instrument -> engine: small flick = few strings, full swing = all strings, recorded
            r = await pg.evaluate("""async () => {
              const ctx = new AudioContext(); await ctx.resume();
              const E = new AK.sound.AudioEngine(ctx, {sampleBase:'/samples/'}); await E.load(['acoustic']);
              const rec = new AK.perf.Recorder(); const I = new AK.inst.Instrument(E, {recorder: rec});
              const M = new AK.motion.Motion(); I.attach(M);
              rec.start(ctx.currentTime, 'acoustic');
              const G=16384, L=65.5, pk=(pads,g)=>({pads,capOk:true,raw:[0,0,G,0,0,Math.round(g*L)]});
              let t=0; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
              async function swing(peak,n){ for(let i=0;i<n;i++){ M.feed('fret', pk(1,0), t); M.feed('strum', pk(0, peak*Math.sin(Math.PI*i/(n-1))), t+=16); await sleep(16);} for(let i=0;i<6;i++){ M.feed('strum', pk(0,0), t+=16); await sleep(16);} }
              for(let i=0;i<5;i++){ M.feed('fret', pk(1,0), t); M.feed('strum', pk(0,0), t+=16); }
              await swing(260, 6);       // flick
              await swing(380, 16);      // full
              await sleep(300);
              const perf = rec.stop(ctx.currentTime);
              const ids = [...new Set(perf.events.filter(e=>e.e==='note').map(e=>e.id))];
              const per = ids.map(id => perf.events.filter(e=>e.e==='note'&&e.id===id).map(e=>e.s));
              await ctx.close();
              return {per, chords: perf.events.filter(e=>e.e==='chord').map(e=>e.label), strokes: perf.events.filter(e=>e.e==='stroke').length};
            }""")
            check("flick plays 1-2 strings from the low side", len(r["per"]) == 2 and len(r["per"][0]) <= 2 and r["per"][0][0] == 0, r)
            check("full swing plays all 6 strings of G in order", r["per"][1] == [0,1,2,3,4,5], r)
            check("chord + strokes recorded", r["chords"] == ["G"] and r["strokes"] == 2, r)

            # 3. render each sound offline from a recorded-style performance: levels, no clipping
            mk = """(voice, studio) => { const ev=[]; let id=0; const prog=[['G',[43,47,50,55,59,67]],['C',[null,48,52,55,60,64]],['D',[null,null,50,57,62,66]],['Em',[40,47,52,55,59,64]]];
              const v = AK.chords.voicing; for(let k=0;k<16;k++){ const t=0.2+k*0.25, name=prog[Math.floor(k/4)][0], c=v(name, voice); id++;
                const d=k%2?-1:1, order=AK.chords.strokeStrings(c.notes, d, k%4===3?2:6); ev.push({t,e:'stroke',id,d,v:0.7});
                order.forEach((s,j)=>ev.push({t:t+j*0.008,e:'note',s,m:c.notes[s],v:0.7,id})); }
              ev.push({t:4.4,e:'chuck',d:1,v:0.8,id:99}); return {v:1, voice, duration:5.5, studio, events:ev}; }"""
            stats = {}
            for voice in ["acoustic","rock","metal"]:
                for studio in [False, True]:
                    r = await pg.evaluate(f"""async () => {{ const perf = ({mk})('{voice}', {str(studio).lower()});
                      const buf = await AK.player.renderOffline(perf, {{sampleRate:{SR}}});
                      const L=buf.getChannelData(0), Rr=buf.getChannelData(1); let peak=0, sum=0, nan=0, corr=0, lr=0, rr=0;
                      for(let i=0;i<L.length;i++){{ const a=L[i], b=Rr[i]; if(!isFinite(a)||!isFinite(b)) nan++; peak=Math.max(peak,Math.abs(a),Math.abs(b)); sum+=a*a; corr+=a*b; lr+=a*a; rr+=b*b; }}
                      const wav = AK.player.encodeWav(buf); const u8=new Uint8Array(wav); let s=''; for(let i=0;i<u8.length;i+=0x8000) s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));
                      return {{peak, rms: Math.sqrt(sum/L.length), nan, width: 1-corr/Math.sqrt(lr*rr), wav: btoa(s)}}; }}""")
                    name = f"{voice}{'_studio' if studio else ''}"
                    open(f"{ROOT}/test/out_{name}.wav","wb").write(__import__('base64').b64decode(r.pop("wav")))
                    stats[name] = r
                    check(f"{name}: sound, no clipping, no NaN", r["nan"]==0 and 0.02 < r["rms"] and r["peak"] < 0.995, {k:round(v,3) for k,v in r.items()})
            for voice in ["acoustic","rock"]:
                check(f"{voice}: studio (Enhance) is wider", stats[voice+"_studio"]["width"] > stats[voice]["width"] + 0.02, (round(stats[voice]["width"],3), round(stats[voice+"_studio"]["width"],3)))

            # 4. slide: hold G, strum, slide up 2 -> ringing low E string bends from G2 to A2
            r = await pg.evaluate("""async () => { const ev=[{t:0.1,e:'note',s:0,m:43,v:0.8},{t:0.9,e:'glide',semis:2,dur:0.1}];
              const buf = await AK.player.renderOffline({v:1,voice:'acoustic',duration:1.8,studio:false,events:ev},{sampleRate:44100});
              const d = buf.getChannelData(0); const a = d.subarray(Math.floor(0.45*44100), Math.floor(0.45*44100)+16000), b = d.subarray(Math.floor(1.25*44100), Math.floor(1.25*44100)+16000);
              return {before: pitch(a, 44100, 60, 300), after: pitch(b, 44100, 60, 300)}; }""")
            semis = 12*math.log2(r["after"]/r["before"])
            check("neck slide bends ringing string by +2 semitones", abs(semis-2) < 0.25 and abs(r["before"]-98) < 3, {k:round(v,1) for k,v in r.items()})

            # 5. fallback when samples are unavailable
            r = await pg.evaluate("""async () => { const buf = await AK.player.renderOffline({v:1,voice:'rock',duration:1.5,events:[{t:0.1,e:'note',s:1,m:45,v:0.8}]},{useSamples:false});
              const d = buf.getChannelData(0); let s=0; for(const x of d) s+=x*x; return Math.sqrt(s/d.length); }""")
            check("modelled strings used if samples can't load", r > 0.01, r)

            # 6. full loop: recorded performance -> enhance -> renders; band hits recorded and replayed
            r = await pg.evaluate("""async () => {
              const off = new OfflineAudioContext(2, 44100, 44100); const E = new AK.sound.AudioEngine(off, {sampleBase:'/samples/'});
              const got=[]; E.onEvent=(t,e)=>got.push(e.e+(e.i?':'+e.i:'')); E.drum('kick',0.1); E.drum('snare',0.2); E.bass(31,0.3,0.2); E.glide(2,0.4);
              return got; }""")
            check("band hits + slides are recordable events", r == ["drum:kick","drum:snare","bass","glide"], r)
            check("no JS errors", not errs, errs[:3])
            await b.close()
    finally:
        srv.terminate()
    ok = sum(1 for v in R.values() if v[0])
    for k,(o,i) in R.items(): print(("PASS " if o else "FAIL ")+k+("" if o else f"  -> {str(i)[:300]}"))
    print(f"\n{ok} passed, {len(R)-ok} failed")

asyncio.run(main())
