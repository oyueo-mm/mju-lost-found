"""D-4 CSP browser check (Chromium + WebKit) against CSP_BASE, a LOCAL build made
with MJU_CSP_MODE=enforce (or report-only). Every page records
securitypolicyviolation events; any violation fails the run. Flows:
anonymous home/lists/search, a post with a Storage photo (optimized and
direct), unified photo search (blob: preview + multipart search), Google
sign-in leaving for accounts.google.com, and signed-in pages incl. the
post-form photo preview. The private chat WebSocket is covered by
realtime-two-member.py on the same build. Called by csp-browser.mjs."""
import json
import os
import sys
from playwright.sync_api import sync_playwright

base = os.environ["CSP_BASE"]
session = os.environ["CSP_SESSION"]
post = json.loads(os.environ["CSP_POST"])  # {"type","id","imageUrl"}
photo = os.environ["CSP_PHOTO"]
result = {"passed": False, "checks": [], "violations": [], "engines": []}
INIT = "document.addEventListener('securitypolicyviolation', e => console.error('CSP-VIOLATION ' + e.effectiveDirective + ' ' + (e.blockedURI || '').split('?')[0] + ' ' + e.disposition + ' at ' + (e.sourceFile || '').replace(location.origin, '') + ':' + e.lineNumber + ':' + e.columnNumber))"


def watch(page, engine):
    page.add_init_script(INIT)
    page.on("console", lambda m: result["violations"].append(f"{engine} {page.url.split('?')[0].replace(base, '')} {m.text[:160]}") if ("CSP-VIOLATION" in m.text or "Content Security Policy" in m.text) else None)


def check(name):
    if name not in result["checks"]:
        result["checks"].append(name)


try:
    with sync_playwright() as p:
        for engine_name, engine in (("chromium", p.chromium), ("webkit", p.webkit)):
            browser = engine.launch()
            result["engines"].append(engine_name)
            # anonymous
            ctx = browser.new_context(locale="ko-KR", viewport={"width": 1280, "height": 900})
            page = ctx.new_page(); watch(page, engine_name)
            for path in ("/", "/lost", "/found", "/search?q=%EC%A7%80%EA%B0%91", "/login", "/policy/privacy"):
                r = page.goto(base + path)
                assert r and r.status < 400, f"{path} {r.status if r else 'no response'}"
                page.wait_for_load_state("networkidle")
                csp = (r.headers.get("content-security-policy") or r.headers.get("content-security-policy-report-only") or "")
                assert "connect-src" in csp, f"{path}: CSP header missing"
            check("anonymous pages load with the CSP header")
            # a post with a Storage photo: optimized (/_next/image) and direct Storage URL
            page.goto(f"{base}/post/{post['id']}?type={post['type']}")
            page.wait_for_load_state("networkidle")
            loaded = page.evaluate("Array.from(document.images).filter(i => i.complete && i.naturalWidth > 0).map(i => i.currentSrc || i.src)")
            assert any("/_next/image" in s or "supabase.co" in s for s in loaded), "post photo did not load"
            direct = page.evaluate("src => new Promise(ok => { const i = new Image(); i.onload = () => ok(i.naturalWidth > 0); i.onerror = () => ok(false); i.src = src; })", post["imageUrl"])
            assert direct, "direct Storage image blocked"
            check("post photo loads (optimized and direct Storage URL)")
            # unified photo search: blob: preview + multipart POST to /api/posts
            page.goto(base + "/search")
            page.wait_for_load_state("networkidle")
            with page.expect_response(lambda r: "/api/posts" in r.url and r.request.method == "POST", timeout=60000) as resp:
                page.locator('input[type="file"]').first.set_input_files(photo)
                page.wait_for_timeout(500)
                preview = page.evaluate("Array.from(document.images).some(i => i.src.startsWith('blob:') && i.complete && i.naturalWidth > 0)")
                assert preview, "blob: photo preview blocked"
                form = page.locator('input[type="file"]').first.locator("xpath=ancestor::form[1]")
                if form.count():
                    form.evaluate("f => f.requestSubmit()")
                else:
                    page.keyboard.press("Enter")
            assert resp.value.status == 200, f"image search {resp.value.status}"
            page.wait_for_load_state("networkidle")
            check("photo search: blob: preview and image search request")
            # Google sign-in leaves for accounts.google.com
            page.goto(base + "/login")
            page.wait_for_load_state("networkidle")
            google = []
            page.on("request", lambda r: google.append(r.url) if r.url.startswith("https://accounts.google.com/") else None)
            page.locator("form button[type=submit]").first.click()
            page.wait_for_timeout(6000)
            assert google, "no navigation to accounts.google.com"
            check("Google sign-in navigates to accounts.google.com")
            ctx.close()
            # signed in
            ctx = browser.new_context(locale="ko-KR", viewport={"width": 390, "height": 844})
            ctx.add_cookies([{"name": "authjs.session-token", "value": session, "url": base}])
            page = ctx.new_page(); watch(page, engine_name)
            for path in ("/", "/chat", "/notifications", "/posts/mine", "/me"):
                r = page.goto(base + path)
                assert r and r.status < 400, f"{path} {r.status if r else 'no response'}"
                page.wait_for_load_state("networkidle")
            check("signed-in pages load")
            page.goto(base + "/lost/new")
            page.wait_for_load_state("networkidle")
            page.locator('input[type="file"]').first.set_input_files(photo)
            page.wait_for_timeout(800)
            assert page.evaluate("Array.from(document.images).some(i => i.src.startsWith('blob:') && i.complete && i.naturalWidth > 0)"), "post-form blob: preview blocked"
            check("post form photo preview (blob:)")
            ctx.close()
            browser.close()
    assert not result["violations"], "violations"
    result["passed"] = True
except Exception as error:  # noqa: BLE001
    result["error"] = f"{type(error).__name__}: {str(error)[:300]}"
result["violations"] = sorted(set(result["violations"]))[:20]
print(json.dumps(result, ensure_ascii=False), flush=True)
sys.exit(0 if result["passed"] else 1)
