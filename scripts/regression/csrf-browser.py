"""Browser half of scripts/regression/csrf-local.mjs (P-2/P-3).

A member's browser (session cookie set the way Auth.js sets it: HttpOnly,
SameSite=Lax) opens an attacker page on another site. The page auto-submits
a text/plain form, fires a no-cors credentialed fetch, loads an <img>, and
then navigates top-level to GET .../messages. The Node half checks the DB
afterwards; this half only reports what the browsers saw. Never prints the
cookie or any response body.
"""
import json
import sys

from playwright.sync_api import sync_playwright

cfg = json.loads(sys.stdin.read())
base, attacker, room = cfg["base"], cfg["attacker"], cfg["roomId"]
result = {"passed": False, "engines": {}}

with sync_playwright() as p:
    for name in ("chromium", "webkit"):
        browser = getattr(p, name).launch(headless=True)
        ctx = browser.new_context()
        ctx.add_cookies([{"name": "authjs.session-token", "value": cfg["cookie"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
        seen = []

        def on_response(resp, seen=seen):
            if resp.url.startswith(base + "/api/chat/"):
                req = resp.request
                seen.append({
                    "method": req.method,
                    "path": resp.url[len(base):].split("?")[0],
                    "status": resp.status,
                    "navigation": req.is_navigation_request(),
                })

        ctx.on("response", on_response)
        page = ctx.new_page()
        page.goto(attacker + "/", wait_until="load")
        try:
            page.wait_for_url(base + f"/api/chat/{room}/messages", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(1500)
        landed = page.url.startswith(base + f"/api/chat/{room}/messages")
        result["engines"][name] = {"landedOnMessages": landed, "responses": seen}
        ctx.close()
        browser.close()

# The attack ran in both engines if each reached the final top-level GET.
result["passed"] = all(e["landedOnMessages"] for e in result["engines"].values())
print(json.dumps(result))
