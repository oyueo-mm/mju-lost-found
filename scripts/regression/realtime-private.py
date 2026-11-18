"""Real Chromium + hosted Preview Realtime; local-only Auth.js cookies on stdin.
No trace, screenshots, raw network frames, cookies or JWT are logged.
"""
import base64
import json
import sys
import time
from playwright.sync_api import sync_playwright, expect

cfg = json.load(sys.stdin)
base, room = cfg["base"], cfg["roomId"]
assert base == "http://localhost:3102" and isinstance(room, int)
checks = []
counters = {"tokens": 0, "joined": 0, "broadcasts": 0, "sockets": 0, "frames": 0}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        contexts = []
        for cookie in cfg["cookies"]:
            ctx = browser.new_context()
            ctx.add_cookies([{"name": "authjs.session-token", "value": cookie, "url": base}])
            contexts.append(ctx)
        first, second, outsider = contexts
        if cfg.get("legacySession"):
            legacy = first.request.post(f"{base}/api/chat/{room}/realtime", headers={"origin": base})
            assert legacy.status == 409
            refreshed = first.request.get(f"{base}/api/auth/session")
            assert refreshed.status == 200
            bootstrapped = first.request.post(f"{base}/api/chat/{room}/realtime", headers={"origin": base})
            assert bootstrapped.status == 200
            checks.append("legacy Auth.js cookie bootstraps without re-login or session secret changes")
        page = first.new_page()

        def count_response(response):
            if response.url == f"{base}/api/chat/{room}/realtime" and response.status == 200:
                counters["tokens"] += 1

        def socket_open(socket):
            counters["sockets"] += 1
            def frame_received(payload):
                try:
                    # realtime-js 2.115 uses binary kind=4 for received user
                    # broadcasts, while join acknowledgements remain JSON.
                    if isinstance(payload, bytes):
                        counters["frames"] += 1
                        if len(payload) >= 5 and payload[0] == 4 and len(payload) >= 5 + sum(payload[1:4]):
                            counters["broadcasts"] += 1
                        return
                    frame = json.loads(payload)
                    counters["frames"] += 1
                    # Phoenix V2 can encode [join_ref, ref, topic, event, payload].
                    event, body = (frame[3], frame[4]) if isinstance(frame, list) and len(frame) == 5 else (frame.get("event"), frame.get("payload", {}))
                    if event == "phx_reply" and body.get("status") == "ok":
                        counters["joined"] += 1
                    if event == "broadcast":
                        counters["broadcasts"] += 1
                except (ValueError, AttributeError):
                    pass
            socket.on("framereceived", frame_received)

        page.on("response", count_response)
        page.on("websocket", socket_open)
        print("stage:initial", flush=True)
        started = time.monotonic()
        page.goto(f"{base}/chat/{room}")
        field = page.locator('input[type="text"]').last
        expect(field).to_be_visible(timeout=30000)
        for _ in range(600):
            if counters["tokens"] and counters["joined"]:
                break
            page.wait_for_timeout(25)
        assert counters["tokens"] and counters["joined"]
        checks.append("member page obtains scoped token and joins hosted private socket")
        token_response = first.request.post(f"{base}/api/chat/{room}/realtime", headers={"origin": base})
        assert token_response.status == 200 and "no-store" in token_response.headers["cache-control"]
        checks.append("token endpoint disables caching")
        before = counters["broadcasts"]
        response = second.request.post(f"{base}/api/chat/{room}/messages", data={"content": "D3 live private delivery"})
        assert response.ok
        expect(page.get_by_text("D3 live private delivery", exact=True)).to_be_visible(timeout=8000)
        for _ in range(100):
            if counters["broadcasts"] > before:
                break
            page.wait_for_timeout(25)
        assert counters["broadcasts"] > before
        checks.append("actual private broadcast triggers authenticated message refresh")
        other_tab = first.new_page()
        other_tab.goto(f"{base}/chat/{room}")
        expect(other_tab.get_by_text("D3 live private delivery", exact=True)).to_be_visible(timeout=30000)
        response = second.request.post(f"{base}/api/chat/{room}/messages", data={"content": "D3 two private tabs"})
        assert response.ok
        for tab in (page, other_tab):
            expect(tab.get_by_text("D3 two private tabs", exact=True)).to_be_visible(timeout=8000)
        checks.append("multiple tabs receive authorized private events")
        field.fill("D3 private draft retained")
        page.locator('input[type="file"]').set_input_files({
            "name": "connection-fixture.png",
            "mimeType": "image/png",
            "buffer": base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP8sAAAAASUVORK5CYII="),
        })
        preview = page.locator('img[src^="blob:"]')
        expect(preview).to_be_visible()
        page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))")
        response = second.request.post(f"{base}/api/chat/{room}/messages", data={"content": "D3 hidden private update"})
        assert response.ok
        page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'))")
        expect(page.get_by_text("D3 hidden private update", exact=True)).to_be_visible(timeout=15000)
        expect(field).to_have_value("D3 private draft retained")
        checks.append("visibility reconnect catches up without losing unsent draft")
        token_route = f"**/api/chat/{room}/realtime"
        print("stage:polling", flush=True)
        status = page.get_by_test_id("chat-connection-status")
        page.route(token_route, lambda route: route.fulfill(status=503, json={}))
        page.evaluate("window.dispatchEvent(new Event('online'))")
        expect(status).to_be_visible(timeout=10000)
        expect(status).not_to_be_empty()
        response = second.request.post(f"{base}/api/chat/{room}/messages", data={"content": "D3 polling with selected photo"})
        assert response.ok
        expect(page.get_by_text("D3 polling with selected photo", exact=True)).to_be_visible(timeout=35000)
        expect(field).to_have_value("D3 private draft retained")
        expect(preview).to_be_visible()
        checks.append("outage notice and authenticated polling retain draft and photo")
        page.unroute(token_route)
        page.evaluate("window.dispatchEvent(new Event('online'))")
        expect(status).to_be_empty(timeout=15000)
        checks.append("private recovery clears notice without reloading the page")
        first.set_offline(True)
        page.wait_for_timeout(500)
        first.set_offline(False)
        page.evaluate("window.dispatchEvent(new Event('online'))")
        response = second.request.post(f"{base}/api/chat/{room}/messages", data={"content": "D3 private network restored"})
        assert response.ok
        expect(page.get_by_text("D3 private network restored", exact=True)).to_be_visible(timeout=15000)
        checks.append("private transport reconnects after network interruption")
        baseline_tokens = counters["tokens"]
        renewal_started = time.monotonic()
        print("stage:renewal", flush=True)
        # Wait beyond a full 120-second token lifetime, keeping the real page
        # and provider socket alive rather than mocking time or token expiry.
        while time.monotonic() - renewal_started < 125:
            page.wait_for_timeout(500)
        assert counters["tokens"] > baseline_tokens
        before = counters["broadcasts"]
        response = second.request.post(f"{base}/api/chat/{room}/messages", data={"content": "D3 after real token renewal"})
        assert response.ok
        expect(page.get_by_text("D3 after real token renewal", exact=True)).to_be_visible(timeout=8000)
        for _ in range(100):
            if counters["broadcasts"] > before:
                break
            page.wait_for_timeout(25)
        assert counters["broadcasts"] > before
        checks.append("real token renewal preserves private reception beyond initial expiry")
        assert outsider.request.get(f"{base}/api/chat/{room}/messages").status == 403
        assert outsider.request.post(f"{base}/api/chat/{room}/realtime", headers={"origin": base}).status == 403
        checks.append("outsider API and token access remain denied")
        first.clear_cookies()
        page.evaluate("window.dispatchEvent(new Event('online'))")
        expect(page.get_by_text("D3 live private delivery", exact=True)).to_have_count(0, timeout=15000)
        checks.append("lost authentication clears private content")
        elapsed = round(time.monotonic() - started, 1)
        for ctx in contexts:
            ctx.close()
        browser.close()
    print("stage:completed", flush=True)
    print(json.dumps({"suite": "D3 real private Chromium", "passed": len(checks), "checks": checks, "elapsedSeconds": elapsed, "tokenResponses": counters["tokens"], "privateBroadcasts": counters["broadcasts"], "osBackgroundVerified": False}))
except Exception as error:
    print(json.dumps({"completedChecks": checks, "errorType": type(error).__name__, "line": error.__traceback__.tb_lineno, "counters": counters}))
    sys.exit(1)
