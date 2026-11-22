"""A-5 budget measurement (anonymous, read-only): how many requests that the
public read guard counts (src/lib/security/readGuard.ts: list/search/detail
pages incl. their RSC/prefetch requests, and GET /api/posts*) does ONE person
produce in an ordinary browse? Reads {base, key} JSON on stdin (key = Preview
automation bypass, never printed). Prints counts per scenario step only."""
import json, re, sys, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

cfg = json.load(sys.stdin)
base, key = cfg["base"].rstrip("/"), cfg.get("key") or ""
GUARDED_PAGE = re.compile(r"^/(lost|found|search)/?$|^/post/[^/]+/?$")
GUARDED_API = re.compile(r"^/api/posts(/[^/]+(/comments)?)?/?$")

counts = {"document": 0, "rsc": 0, "api": 0}
def on_request(req):
    u = urlparse(req.url)
    if not req.url.startswith(base) or req.method != "GET":
        return
    if GUARDED_API.match(u.path):
        counts["api"] += 1
    elif GUARDED_PAGE.match(u.path):
        is_rsc = "_rsc=" in (u.query or "") or req.headers.get("rsc") == "1"
        counts["rsc" if is_rsc else "document"] += 1

steps = []
def mark(name, started):
    steps.append({"step": name, "guarded": sum(counts.values()), **counts, "seconds": round(time.time() - started, 1)})

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(extra_http_headers={"x-vercel-protection-bypass": key, "x-vercel-set-bypass-cookie": "samesitenone"} if key else {})
    page = ctx.new_page()
    page.on("request", on_request)
    t0 = time.time()
    page.goto(base + "/lost", wait_until="networkidle")
    mark("open /lost", t0)
    for _ in range(4):
        page.mouse.wheel(0, 1600)
        page.wait_for_timeout(700)
    links = page.locator("a[href^='/post/']")
    for i in range(min(links.count(), 12)):
        try:
            links.nth(i).hover(timeout=2000)
        except Exception:
            pass
        page.wait_for_timeout(150)
    page.wait_for_load_state("networkidle")
    mark("scroll + hover 12 cards", t0)
    hrefs = []
    for i in range(min(links.count(), 3)):
        h = links.nth(i).get_attribute("href")
        if h and h not in hrefs:
            hrefs.append(h)
    for h in hrefs:
        page.locator(f"a[href='{h}']").first.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(800)
        page.go_back(wait_until="networkidle")
    mark(f"open {len(hrefs)} posts and back", t0)
    page.goto(base + "/search?q=%EC%A7%80%EA%B0%91", wait_until="networkidle")
    mark("search", t0)
    page.goto(base + "/found", wait_until="networkidle")
    page.mouse.wheel(0, 2400)
    page.wait_for_timeout(1500)
    mark("open /found + scroll", t0)
    browser.close()

print(json.dumps({"base": base, "steps": steps, "total": sum(counts.values()), "perKind": counts}))
