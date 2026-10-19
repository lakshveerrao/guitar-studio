"""Screenshots of site pages: python3 test/shots.py page[,page] -> /tmp/ak-shot-<name>-<w>.png"""
import asyncio, sys
from playwright.async_api import async_playwright
pages = sys.argv[1].split(",") if len(sys.argv) > 1 else ["/"]
widths = [int(w) for w in (sys.argv[2].split(",") if len(sys.argv) > 2 else ["1280","390"])]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        for path in pages:
            for w in widths:
                pg = await b.new_page(viewport={"width": w, "height": 900 if w > 600 else 844})
                errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type=="error" and "fonts" not in m.text else None)
                await pg.goto("http://127.0.0.1:8787" + path); await pg.wait_for_timeout(1200)
                await pg.evaluate("document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in'))")
                await pg.wait_for_timeout(800)
                name = path.strip("/").replace("/","_") or "home"
                await pg.screenshot(path=f"/tmp/ak-shot-{name}-{w}.png", full_page=True)
                ov = await pg.evaluate("document.documentElement.scrollWidth - innerWidth")
                print(name, w, "overflow", ov, "errors", errs[:3])
                await pg.close()
        await b.close()
asyncio.run(main())
