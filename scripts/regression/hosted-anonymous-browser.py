"""D-4: read-only anonymous browser check on a HOSTED deployment (Chromium + WebKit).

No login, no cookies, nothing created: page views, one photo search (search only,
same as release-probes' image probe), and the Google sign-in button up to the
accounts.google.com navigation (never signs in).

  python -I scripts/regression/hosted-anonymous-browser.py https://mju-find.vercel.app

Checks per engine:
  - home / lists / search / login / privacy load with the four D-4 headers
  - a list photo and a post detail photo render (/_next/image or Storage)
  - photo search: blob: preview + POST /api/posts answers 200
  - Google sign-in leaves for accounts.google.com
  - the site refuses to be framed (X-Frame-Options DENY)
  - no CSP violation and no uncaught page error
Only paths without query strings are printed.
"""
import json
import sys
from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip("/")
assert base.startswith("https://"), "hosted https base required"
photo = "docs/ai-eval-seed/query-images/R12.jpg"
HEADERS = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "geolocation=(), microphone=(), payment=(), usb=()",
}
INIT = "document.addEventListener('securitypolicyviolation', e => console.error('CSP-VIOLATION ' + e.effectiveDirective + ' ' + (e.blockedURI || '').split('?')[0]))"
result = {"base": base, "passed": False, "checks": [], "problems": [], "engines": []}


def check(name):
    if name not in result["checks"]:
        result["checks"].append(name)


def watch(page, engine):
    page.add_init_script(INIT)
    # Only our own pages count (Google's sign-in page has its own console noise).
    ours = lambda: page.url.startswith(base + "/") or page.url == base
    page.on("console", lambda m: result["problems"].append(f"{engine} {page.url.split('?')[0].replace(base, '')} {m.text[:160]}") if ours() and ("CSP-VIOLATION" in m.text or "Content Security Policy" in m.text) else None)
    page.on("pageerror", lambda e: result["problems"].append(f"{engine} pageerror {page.url.split('?')[0].replace(base, '')} {str(e)[:160]}") if ours() else None)


try:
    with sync_playwright() as p:
        for engine_name, engine in (("chromium", p.chromium), ("webkit", p.webkit)):
            browser = engine.launch()
            result["engines"].append(engine_name)
            ctx = browser.new_context(locale="ko-KR", viewport={"width": 1280, "height": 900})
            page = ctx.new_page()
            watch(page, engine_name)
            for path in ("/", "/lost", "/found", "/search", "/login", "/policy/privacy"):
                r = page.goto(base + path)
                assert r and r.status < 400, f"{path} {r.status if r else 'no response'}"
                page.wait_for_load_state("networkidle")
                h = r.headers
                bad = [k for k, v in HEADERS.items() if h.get(k) != v]
                assert not bad, f"{path} header mismatch {bad}"
            check("pages load with the four headers")

            # list photo + post detail photo
            page.goto(base + "/found")
            page.wait_for_load_state("networkidle")
            hrefs = page.evaluate("""() => [...new Set(Array.from(document.querySelectorAll('a[href^="/post/"]')).map(a => a.getAttribute('href')))].slice(0, 15)""")
            found_photo = False
            for href in hrefs:
                page.goto(base + href)
                page.wait_for_load_state("networkidle")
                loaded = page.evaluate("Array.from(document.images).filter(i => i.complete && i.naturalWidth > 0).map(i => i.currentSrc || i.src)")
                if any("/_next/image" in s or "supabase.co" in s for s in loaded):
                    found_photo = True
                    break
            assert found_photo, "no post photo rendered in the first 15 posts"
            check("post detail photo renders")

            # photo search
            page.goto(base + "/search")
            page.wait_for_load_state("networkidle")
            with page.expect_response(lambda r: "/api/posts" in r.url and r.request.method == "POST", timeout=90000) as resp:
                page.locator('input[type="file"]').first.set_input_files(photo)
                page.wait_for_timeout(500)
                assert page.evaluate("Array.from(document.images).some(i => i.src.startsWith('blob:') && i.complete && i.naturalWidth > 0)"), "blob: preview did not render"
                form = page.locator('input[type="file"]').first.locator("xpath=ancestor::form[1]")
                if form.count():
                    form.evaluate("f => f.requestSubmit()")
                else:
                    page.keyboard.press("Enter")
            assert resp.value.status == 200, f"image search {resp.value.status}"
            check("photo search: blob: preview and search request 200")

            # Google sign-in navigation (stop at Google)
            page.goto(base + "/login")
            page.wait_for_load_state("networkidle")
            google = []
            page.on("request", lambda r: google.append(r.url) if r.url.startswith("https://accounts.google.com/") else None)
            page.locator("form button[type=submit]").first.click()
            page.wait_for_timeout(6000)
            assert google, "no navigation to accounts.google.com"
            check("Google sign-in navigates to accounts.google.com")
            ctx.close()

            # framing refused
            ctx = browser.new_context()
            page = ctx.new_page()
            page.set_content(f'<iframe id="f" src="{base}/login" style="width:600px;height:400px"></iframe>')
            page.wait_for_timeout(4000)
            framed = page.frame_locator("#f").locator("form button[type=submit]").count()
            assert framed == 0, "login page rendered inside an iframe"
            check("site refuses to be framed")
            ctx.close()
            browser.close()
    assert not result["problems"], "problems"
    result["passed"] = True
except Exception as error:  # noqa: BLE001
    result["error"] = f"{type(error).__name__}: {str(error)[:300]}"
result["problems"] = sorted(set(result["problems"]))[:20]
print(json.dumps(result, ensure_ascii=False), flush=True)
sys.exit(0 if result["passed"] else 1)
