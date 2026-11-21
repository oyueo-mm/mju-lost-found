"""D-4 CSP report delivery check (Chromium + WebKit), driven by csp-report-browser.mjs.

Phase "clean": normal anonymous pages (home, lists, search, a photo post,
login, Google sign-in redirect) -- these must produce NO report.
Phase "inject": one deliberate violation per engine and directive, added from
the page itself (a cross-origin image and a cross-origin fetch). In
Report-Only mode they are reported, not blocked. Marker hosts are
"csp-check-<engine>.invalid" so the server log can be matched.
Both engines deliver through report-uri (the policy names no report-to;
see src/lib/security/csp.mjs). Prints JSON.
"""
import json
import os
import sys
from playwright.sync_api import sync_playwright

base = os.environ["CSP_BASE"]
post = json.loads(os.environ["CSP_POST"])
# Hosted Preview: Deployment Protection bypass for every request of the context
# (also sets the bypass cookie, so the browser's own report POSTs get through).
bypass = os.environ.get("CSP_BYPASS")
extra = {"x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "samesitenone"} if bypass else None
phase = sys.argv[1]
result = {"phase": phase, "engines": [], "checks": [], "passed": False}

try:
    with sync_playwright() as p:
        for name, engine in (("chromium", p.chromium), ("webkit", p.webkit)):
            browser = engine.launch()
            result["engines"].append(name)
            ctx = browser.new_context(locale="ko-KR", extra_http_headers=extra) if extra else browser.new_context(locale="ko-KR")
            page = ctx.new_page()
            if phase == "clean":
                for path in ("/", "/lost", "/found", "/search", "/policy/privacy", f"/post/{post['id']}?type={post['type']}", "/login"):
                    r = page.goto(base + path)
                    assert r and r.status < 400, path
                    h = r.headers
                    assert "report-uri /api/csp-report" in (h.get("content-security-policy-report-only") or ""), f"{path}: report-only header missing"
                    page.wait_for_load_state("networkidle")
                google = []
                page.on("request", lambda r: google.append(1) if r.url.startswith("https://accounts.google.com/") else None)
                page.locator("form button[type=submit]").first.click()
                page.wait_for_timeout(5000)
                assert google, "no Google navigation"
                result["checks"].append(f"{name}: normal pages + Google redirect")
            else:
                page.goto(base + "/")
                page.wait_for_load_state("networkidle")
                page.evaluate("""engine => {
                  const img = document.createElement('img');
                  img.src = 'https://csp-check-' + engine + '.invalid/pixel.png?secret=1';
                  document.body.appendChild(img);
                  fetch('https://csp-check-' + engine + '.invalid/api?secret=1').catch(() => {});
                }""", name)
                page.wait_for_timeout(5000)
                result["checks"].append(f"{name}: injected img-src + connect-src")
            ctx.close()
            browser.close()
    result["passed"] = True
except Exception as error:  # noqa: BLE001
    result["error"] = f"{type(error).__name__}: {str(error)[:300]}"
print(json.dumps(result, ensure_ascii=False), flush=True)
sys.exit(0 if result["passed"] else 1)
