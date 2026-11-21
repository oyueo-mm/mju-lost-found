"""Browser API fallback tests. Reads local-only fixture cookies from stdin."""
import json
import re
import sys
import time
from playwright.sync_api import sync_playwright, expect

cfg = json.load(sys.stdin)
base, room = cfg["base"], cfg["roomId"]
assert base == "http://localhost:3102" and isinstance(room, int)
checks = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        contexts = []
        for cookie in cfg["cookies"]:
            ctx = browser.new_context()
            ctx.add_cookies([{"name": "authjs.session-token", "value": cookie, "url": base}])
            contexts.append(ctx)
        first, second, outsider = contexts
        # Diagnostics only (printed on failure): method, route shape, status, time.
        api_log = []
        started = time.monotonic()
        def log_api(resp):
            if "/api/chat/" in resp.url:
                shape = re.sub(r"/\d+", "/:id", resp.url.split("?")[0].split("/api/", 1)[1])
                api_log.append([round(time.monotonic() - started, 1), resp.request.method, shape, resp.status])
        first.on("response", log_api)
        page = first.new_page()
        page.goto(f"{base}/chat/{room}")
        field = page.locator('input[type="text"]').last
        expect(field).to_be_visible(timeout=30000)
        checks.append("authenticated page and composer")
        token = first.request.post(f"{base}/api/chat/{room}/realtime", headers={"origin": base})
        assert token.status == 503 and "no-store" in token.headers["cache-control"]
        expect(page.get_by_test_id("chat-connection-status")).to_be_visible(timeout=10000)
        expect(page.get_by_test_id("chat-connection-status")).not_to_be_empty()
        checks.append("missing signer fails closed; authenticated API remains")
        response = second.request.post(f"{base}/api/chat/{room}/messages", data={"content": "D3 incoming fallback proof"})
        assert response.status in (200, 201)
        posted_at = time.monotonic()
        expect(page.get_by_text("D3 incoming fallback proof", exact=True)).to_be_visible(timeout=35000)
        delivery_seconds = round(time.monotonic() - posted_at, 2)
        checks.append("incoming message arrives through bounded polling")
        other_tab = first.new_page()
        other_tab.goto(f"{base}/chat/{room}")
        expect(other_tab.get_by_text("D3 incoming fallback proof", exact=True)).to_be_visible(timeout=30000)
        checks.append("second tab independently catches up")
        # Force a GET to see a committed send before its POST response arrives.
        # This used to append the same message twice in the sender's view.
        held_post = []
        path = f"**/api/chat/{room}/messages"
        def hold_post(route):
            if route.request.method == "POST":
                held_post.append((route, route.fetch()))
            else:
                route.continue_()
        page.route(path, hold_post)
        field.fill("D3 own response race")
        page.get_by_role("button", name="전송", exact=True).click()
        for _ in range(200):
            if held_post:
                break
            page.wait_for_timeout(25)
        assert held_post
        page.evaluate("window.dispatchEvent(new Event('online'))")
        expect(page.get_by_text("D3 own response race", exact=True)).to_be_visible(timeout=15000)
        held_post[0][0].fulfill(response=held_post[0][1])
        expect(field).to_have_value("")
        expect(page.get_by_text("D3 own response race", exact=True)).to_have_count(1)
        page.unroute(path, hold_post)
        checks.append("send response arriving after snapshot does not duplicate message")
        # Hold a pre-edit snapshot until after the edit has committed locally.
        held_get = []
        def hold_get(route):
            if route.request.method == "GET" and not held_get:
                held_get.append((route, route.fetch()))
            else:
                route.continue_()
        page.route(path, hold_get)
        page.evaluate("window.dispatchEvent(new Event('online'))")
        for _ in range(200):
            if held_get:
                break
            page.wait_for_timeout(25)
        assert held_get
        page.get_by_role("button", name="메시지 옵션", exact=True).last.click(force=True)
        page.get_by_role("button", name="수정", exact=True).click()
        page.locator("textarea").last.fill("D3 edited current response")
        page.get_by_role("button", name="저장", exact=True).click()
        expect(page.get_by_text("D3 edited current response", exact=True)).to_be_visible()
        page.evaluate("window.__d3Stale=false;new MutationObserver(()=>{if(document.body.textContent.includes('D3 own response race')&&!document.body.textContent.includes('D3 edited current response'))window.__d3Stale=true}).observe(document.body,{childList:true,subtree:true,characterData:true})")
        held_get[0][0].fulfill(response=held_get[0][1])
        page.wait_for_timeout(700)
        assert page.evaluate("window.__d3Stale") is False
        expect(page.get_by_text("D3 edited current response", exact=True)).to_be_visible()
        page.unroute(path, hold_get)
        checks.append("pre-edit GET cannot overwrite a newer successful edit")
        field.fill("D3 preserved unsent draft")
        # Exercise the hook's visibility lifecycle explicitly. Headless Chromium
        # does not reliably expose OS background-tab visibility across platforms.
        page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))")
        second.request.post(f"{base}/api/chat/{room}/messages", data={"content": "D3 while hidden"})
        page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'))")
        expect(page.get_by_text("D3 while hidden", exact=True)).to_be_visible(timeout=15000)
        expect(field).to_have_value("D3 preserved unsent draft")
        checks.append("visibility resume catches up and preserves draft")
        first.set_offline(True)
        first.set_offline(False)
        page.evaluate("window.dispatchEvent(new Event('online'))")
        response = second.request.post(f"{base}/api/chat/{room}/messages", data={"content": "D3 network restored"})
        assert response.ok
        expect(page.get_by_text("D3 network restored", exact=True)).to_be_visible(timeout=35000)
        checks.append("network reconnect resumes authenticated synchronization")
        assert outsider.request.get(f"{base}/api/chat/{room}/messages").status == 403
        assert outsider.request.post(f"{base}/api/chat/{room}/realtime", headers={"origin": base}).status == 403
        checks.append("outsider cannot read or obtain realtime authority")
        quiet_requests = []
        token_path = f"{base}/api/chat/{room}/realtime"

        def deliberate_polling(route):
            quiet_requests.append(route.request.method)
            route.fulfill(status=204)

        page.route(token_path, deliberate_polling)
        page.evaluate("window.dispatchEvent(new Event('online'))")
        response = second.request.post(f"{base}/api/chat/{room}/messages", data={"content": "D3 deliberate polling proof"})
        assert response.ok
        expect(page.get_by_text("D3 deliberate polling proof", exact=True)).to_be_visible(timeout=35000)
        page.wait_for_timeout(32000)
        assert quiet_requests == ["POST"]
        page.unroute(token_path, deliberate_polling)
        checks.append("intentional polling keeps messages current without repeating token requests")
        # Removing the local test cookie exercises expiry/401 without using a
        # deployed authentication secret or touching any real user's session.
        first.clear_cookies()
        page.evaluate("window.dispatchEvent(new Event('online'))")
        expect(page.get_by_text("D3 incoming fallback proof", exact=True)).to_have_count(0, timeout=15000)
        checks.append("expired session clears protected chat state")
        for ctx in contexts:
            ctx.close()
        browser.close()
    print(json.dumps({"suite": "D3 isolated browser API fallback", "passed": len(checks), "checks": checks,
                      "deliverySecondsAfterPost": delivery_seconds, "hostedPrivateRealtimeVerified": False}))
    
except Exception as error:
    import traceback
    print(json.dumps({"suite":"D3 isolated browser API fallback","passed":0,"completedChecks":checks,"errorType":type(error).__name__,"line":traceback.extract_tb(error.__traceback__)[-1].lineno,"apiLog":locals().get("api_log",[])[-40:],"suiteLine":next((f.lineno for f in reversed(traceback.extract_tb(error.__traceback__)) if f.filename.endswith("realtime-fallback.py")),None)}))
    sys.exit(1)
