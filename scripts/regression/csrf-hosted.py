"""Browser half of scripts/regression/csrf-hosted.mjs.

Anonymous. From a page on the deployment, fetch(POST /api/chat/1/read) must
reach authentication (401): the same-origin check accepts a real browser
behind Vercel's proxy. From an attacker page (https://attacker.example,
served by Playwright) the same POST must be refused (403). Prints statuses
only, never the bypass key.
"""
import json
import sys

from playwright.sync_api import sync_playwright

cfg = json.loads(sys.stdin.read())
base, key = cfg["base"], cfg["key"]
ATTACKER = "https://attacker.example/"
attack_html = f"""<!doctype html><script>
fetch("{base}/api/chat/1/read",{{method:"POST",mode:"no-cors",credentials:"include",headers:{{"content-type":"text/plain"}},body:'{{"upToMessageId":1}}'}}).catch(()=>{{}});
</script>"""
result = {"passed": False, "engines": {}}

with sync_playwright() as p:
    for name in ("chromium", "webkit"):
        browser = getattr(p, name).launch(headless=True)
        ctx = browser.new_context(extra_http_headers={"x-vercel-protection-bypass": key, "x-vercel-set-bypass-cookie": "samesitenone"})
        ctx.route(ATTACKER, lambda route: route.fulfill(status=200, content_type="text/html", body=attack_html))
        statuses = []
        ctx.on("response", lambda r, s=statuses: s.append(r.status) if r.url == f"{base}/api/chat/1/read" else None)
        page = ctx.new_page()
        page.goto(base + "/login", wait_until="domcontentloaded")
        same = page.evaluate(
            """async (u) => (await fetch(u, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({upToMessageId: 1})})).status""",
            base + "/api/chat/1/read",
        )
        statuses.clear()
        page.goto(ATTACKER, wait_until="load")
        page.wait_for_timeout(3000)
        result["engines"][name] = {"sameOrigin": same, "attacker": list(statuses)}
        ctx.close()
        browser.close()

result["passed"] = all(e["sameOrigin"] == 401 and e["attacker"] and all(s == 403 for s in e["attacker"]) for e in result["engines"].values())
print(json.dumps(result))
