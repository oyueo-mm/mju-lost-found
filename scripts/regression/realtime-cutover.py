"""Rehearse a same-origin local switch from the D-2 build to D-3 polling."""
import base64
import json
import sys
from playwright.sync_api import sync_playwright, expect

config = json.loads(sys.stdin.readline())
base, room = config["base"], config["roomId"]
assert base == "http://localhost:3102" and isinstance(room, int)
room_url = f"{base}/chat/{room}"
token_url = f"{base}/api/chat/{room}/realtime"
messages_url = f"{base}/api/chat/{room}/messages"
draft = "D-3 cutover draft kept in the original tab"
photo = {
    "name": "cutover-fixture.png",
    "mimeType": "image/png",
    "buffer": base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP8sAAAAASUVORK5CYII="),
}
checks = []
expect_public_off = config.get("expectPublicOff", False)

try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        member, peer = [browser.new_context() for _ in range(2)]
        for context, cookie in zip((member, peer), config["cookies"]):
            context.add_cookies([{"name": "authjs.session-token", "value": cookie, "url": base}])
        old = member.new_page()
        legacy = {"joined": False, "private_only": False, "delivery": True}

        def connect_legacy(socket):
            upstream = socket.connect_to_server()

            def receive(frame):
                if not legacy["delivery"]:
                    return
                if isinstance(frame, str):
                    packet = json.loads(frame)
                    if isinstance(packet, list) and len(packet) == 5:
                        _, _, topic, event, body = packet
                    else:
                        topic, event, body = packet.get("topic"), packet.get("event"), packet.get("payload")
                    if (topic, event) == (f"realtime:chat-room-{room}", "phx_reply") and isinstance(body, dict):
                        status = body.get("status")
                        if status == "ok":
                            legacy["joined"] = True
                        elif status == "error":
                            reason = json.dumps(body.get("response", {})).lower()
                            legacy["private_only"] = "privateonly" in reason or "only allows private channels" in reason
                socket.send(frame)

            upstream.on_message(receive)

        old.route_web_socket("**/realtime/v1/**", connect_legacy)
        old.goto(room_url)
        old_text = old.locator('input[type="text"]').last
        expect(old_text).to_be_visible(timeout=30000)
        old_text.fill(draft)
        old.locator('input[type="file"]').set_input_files(photo)
        expect(old.locator('img[src^="blob:"]')).to_be_visible()
        for _ in range(200):
            if legacy["joined"] or legacy["private_only"]:
                break
            old.wait_for_timeout(50)
        assert legacy["private_only"] and not legacy["joined"] if expect_public_off else legacy["joined"]
        assert member.request.post(token_url, headers={"origin": base}).status == 404
        checks.append("D-2 composer remains usable after provider rejects its public join" if expect_public_off
                      else "D-2 tab has a draft, photo and legacy socket before cutover")

        print("switch-local-server", flush=True)
        assert sys.stdin.readline().strip() == "switched"
        if not expect_public_off:
            # Before the provider policy change, model legacy delivery loss locally.
            legacy["delivery"] = False
        expect(old_text).to_have_value(draft)
        expect(old.locator('img[src^="blob:"]')).to_be_visible()
        checks.append("server switch and loss of legacy events preserve existing composer")

        assert member.request.get(f"{base}/api/auth/session").status == 200
        new = member.new_page()
        new.goto(room_url)
        new_text = new.locator('input[type="text"]').last
        expect(new_text).to_be_visible(timeout=30000)
        token = member.request.post(token_url, headers={"origin": base})
        assert token.status == 503
        checks.append("same session opens D-3 at the same URL in polling mode")

        new_text.fill(old_text.input_value())
        new.locator('input[type="file"]').set_input_files(photo)
        expect(new_text).to_have_value(draft)
        expect(new.locator('img[src^="blob:"]')).to_be_visible()
        expect(old_text).to_have_value(draft)
        checks.append("copying text and reselecting the original file transfers the draft")

        message = "D-3 cutover authenticated polling proof"
        response = peer.request.post(messages_url, data={"content": message})
        assert response.ok
        expect(new.get_by_text(message, exact=True)).to_be_visible(timeout=35000)
        expect(old.get_by_text(message, exact=True)).to_have_count(0)
        expect(new_text).to_have_value(draft)
        expect(new.locator('img[src^="blob:"]')).to_be_visible()
        checks.append("D-3 polls for new messages while the old tab stays stale")
        browser.close()
    print(json.dumps({"suite": "D2 to D3 Chromium cutover", "passed": len(checks), "checks": checks}))
except Exception as error:
    print(json.dumps({"completedChecks": checks, "errorType": type(error).__name__, "line": error.__traceback__.tb_lineno}))
    sys.exit(1)
