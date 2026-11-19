"""Two real member browsers + an outsider on a local build against the hosted
Preview Realtime (private). Driven by realtime-fallback.mjs --two-member.

Checks, in order:
  1. an open room tab that started in polling (token API 204) joins private
     after the mode switch, without a reload
  2. member A sends in the UI -> member B shows it without a reload (and back)
  3. no duplicates; read status reaches the sender
  4. idle socket mode does not poll the messages API on the 10 s polling pace
  5. leaving the room closes its socket; re-entering re-subscribes and catches up
  6. offline -> online: reconnect and the missed message is fetched via the API
  7. from lg the room list beside the thread shows the newest incoming message
  8. outsider: no token, no messages, page shows no content
No message text, cookie, JWT, URL query or raw frame is printed.
"""
import json
import re
import sys
import time
import uuid
from playwright.sync_api import sync_playwright, expect

cfg = json.loads(sys.stdin.readline())
base, room = cfg["base"], cfg["roomId"]
assert base == "http://localhost:3102" and isinstance(room, int)
checks, timings = [], {}
POLLING_TEXT = "실시간 연결을 다시 시도하고 있습니다"


class Probe:
    """Per-page counters: token responses, private joins, sockets, navigations."""

    def __init__(self, page):
        self.page = page
        self.tokens = {200: 0, 204: 0, 403: 0, 409: 0, "other": 0}
        self.joined = 0
        self.sockets_open = 0
        self.sockets_closed = 0
        self.navigations = 0
        self.message_gets = 0
        page.on("response", self.on_response)
        page.on("websocket", self.on_socket)
        page.on("framenavigated", lambda f: setattr(self, "navigations", self.navigations + (1 if f == page.main_frame else 0)))

    def on_response(self, response):
        url = response.url.split("?")[0]
        if url == f"{base}/api/chat/{room}/realtime" and response.request.method == "POST":
            key = response.status if response.status in self.tokens else "other"
            self.tokens[key] += 1
        elif url == f"{base}/api/chat/{room}/messages" and response.request.method == "GET":
            self.message_gets += 1

    def on_socket(self, socket):
        if "/realtime/v1/" not in socket.url:
            return
        self.sockets_open += 1
        socket.on("close", lambda _ws: setattr(self, "sockets_closed", self.sockets_closed + 1))

        def frame(payload):
            if isinstance(payload, bytes):
                return
            try:
                f = json.loads(payload)
                event, body = (f[3], f[4]) if isinstance(f, list) and len(f) == 5 else (f.get("event"), f.get("payload", {}))
                topic = f[2] if isinstance(f, list) and len(f) == 5 else f.get("topic", "")
                if event == "phx_reply" and body.get("status") == "ok" and str(topic).startswith("realtime:mju-chat:"):
                    self.joined += 1
            except (ValueError, AttributeError, IndexError, TypeError):
                pass

        socket.on("framereceived", frame)

    def wait(self, cond, seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if cond():
                return True
            self.page.wait_for_timeout(100)
        return cond()


def send_ui(page, text):
    field = page.locator('input[type="text"]').last
    field.fill(text)
    page.get_by_role("button", name="전송", exact=True).click()


result = {"passed": False, "completedChecks": 0}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctxs = []
        for cookie in cfg["cookies"]:
            ctx = browser.new_context(locale="ko-KR", viewport={"width": 390, "height": 844})
            ctx.add_cookies([{"name": "authjs.session-token", "value": cookie, "url": base}])
            ctxs.append(ctx)
        ca, cb, cc = ctxs

        # 1. polling tab joins after the switch, no reload
        a = ca.new_page(); pa = Probe(a)
        a.goto(f"{base}/chat/{room}")
        expect(a.locator('input[type="text"]').last).to_be_visible(timeout=30000)
        assert pa.wait(lambda: pa.tokens[204] >= 1, 20), "expected a polling 204"
        expect(a.get_by_text(POLLING_TEXT, exact=False)).to_be_visible(timeout=10000)
        nav_before = pa.navigations
        print("switch-to-private", flush=True)
        assert sys.stdin.readline().strip() == "switched", "server switch failed"
        t0 = time.monotonic()
        assert pa.wait(lambda: pa.tokens[200] >= 1 and pa.joined >= 1, 170), "open tab never joined after the switch"
        timings["pollingToPrivateSeconds"] = round(time.monotonic() - t0, 1)
        expect(a.get_by_text(POLLING_TEXT, exact=False)).to_be_hidden(timeout=10000)
        assert pa.navigations == nav_before, "tab reloaded"
        checks.append("open tab in polling mode joins private after the switch without a reload")
        print("stage:polling", flush=True)

        # 2. A -> B and B -> A without reload
        b = cb.new_page(); pb = Probe(b)
        b.goto(f"{base}/chat/{room}")
        expect(b.locator('input[type="text"]').last).to_be_visible(timeout=30000)
        assert pb.wait(lambda: pb.tokens[200] >= 1 and pb.joined >= 1, 30), "member B did not join"
        nav_b = pb.navigations
        m1 = f"two-member {uuid.uuid4()}"
        t0 = time.monotonic()
        send_ui(a, m1)
        expect(b.get_by_text(m1, exact=True)).to_be_visible(timeout=8000)
        timings["aToBSeconds"] = round(time.monotonic() - t0, 2)
        m2 = f"two-member {uuid.uuid4()}"
        t0 = time.monotonic()
        send_ui(b, m2)
        expect(a.get_by_text(m2, exact=True)).to_be_visible(timeout=8000)
        timings["bToASeconds"] = round(time.monotonic() - t0, 2)
        assert pb.navigations == nav_b and pa.navigations == nav_before
        assert timings["aToBSeconds"] < 8 and timings["bToASeconds"] < 8
        checks.append("both members receive each other's UI messages without a reload")

        # 3. duplicates and read status
        a.wait_for_timeout(2500)
        for page, text in ((a, m1), (b, m1), (a, m2), (b, m2)):
            assert page.get_by_text(text, exact=True).count() == 1, "duplicate or missing message"
        checks.append("each message is shown exactly once on both sides")
        # rendered as "<time> · 읽음" under the sender's own message
        expect(a.get_by_text(re.compile(r"·\s*읽음$")).first).to_be_visible(timeout=10000)
        checks.append("read status reaches the sender")

        # 4. idle socket mode: no 10 s polling
        gets = pb.message_gets
        b.wait_for_timeout(25000)
        idle_gets = pb.message_gets - gets
        timings["idleMessageGetsIn25s"] = idle_gets
        assert idle_gets <= 1, "socket mode is still polling on the fallback pace"
        checks.append("connected tab does not poll on the fallback pace")

        # 5. leave and re-enter
        # in-app navigation (React unmount), as a member actually leaves a room
        closed_before = pb.sockets_closed
        b.locator('header a[href="/"]').first.click()
        b.wait_for_url(f"{base}/", timeout=15000)
        assert pb.wait(lambda: pb.sockets_closed > closed_before, 10), "leaving the room kept its socket open"
        m3 = f"two-member {uuid.uuid4()}"
        send_ui(a, m3)
        a.wait_for_timeout(1000)
        joined_before, tokens_before = pb.joined, pb.tokens[200]
        b.go_back()  # client-side re-entry
        b.wait_for_url(f"{base}/chat/{room}", timeout=15000)
        expect(b.get_by_text(m3, exact=True)).to_be_visible(timeout=15000)
        assert pb.wait(lambda: pb.joined > joined_before and pb.tokens[200] > tokens_before, 30), "re-entry did not re-subscribe"
        assert b.get_by_text(m3, exact=True).count() == 1
        checks.append("leaving closes the room socket; re-entering re-subscribes and catches up")

        # 6. offline -> online
        joined_before = pb.joined
        cb.set_offline(True)
        b.wait_for_timeout(3000)
        m4 = f"two-member {uuid.uuid4()}"
        send_ui(a, m4)
        a.wait_for_timeout(3000)
        cb.set_offline(False)
        t0 = time.monotonic()
        expect(b.get_by_text(m4, exact=True)).to_be_visible(timeout=40000)
        timings["offlineCatchUpSeconds"] = round(time.monotonic() - t0, 1)
        assert pb.wait(lambda: pb.joined > joined_before, 60), "no rejoin after the network came back"
        assert b.get_by_text(m4, exact=True).count() == 1
        checks.append("after a network drop the tab rejoins and fetches the missed message")
        print("stage:renewal", flush=True)

        # 7. desktop list beside the thread
        b.set_viewport_size({"width": 1280, "height": 800})
        b.goto(f"{base}/chat/{room}")
        expect(b.locator("aside")).to_be_visible(timeout=15000)
        assert pb.wait(lambda: pb.joined > 0, 5)
        b.wait_for_timeout(1500)
        m5 = f"two-member {uuid.uuid4()}"
        send_ui(a, m5)
        expect(b.locator("aside").get_by_text(m5, exact=True)).to_be_visible(timeout=20000)
        checks.append("room list beside the thread shows the newest incoming message")

        # 8. outsider
        assert cc.request.post(f"{base}/api/chat/{room}/realtime", headers={"origin": base}).status in (403, 409)
        assert cc.request.get(f"{base}/api/chat/{room}/messages").status in (403, 404)
        c = cc.new_page(); pc = Probe(c)
        c.goto(f"{base}/chat/{room}")
        c.wait_for_timeout(4000)
        for text in (m1, m2, m3, m4, m5):
            assert c.get_by_text(text, exact=True).count() == 0, "outsider saw a message"
        assert pc.tokens[200] == 0 and pc.joined == 0, "outsider joined"
        checks.append("outsider gets no token, no messages and no private join")
        print("stage:completed", flush=True)
        browser.close()
    result = {"passed": True, "completedChecks": len(checks), "checks": checks, "timings": timings,
              "counters": {"aTokens": pa.tokens, "aJoins": pa.joined, "bTokens": pb.tokens, "bJoins": pb.joined, "bSocketsClosed": pb.sockets_closed}}
except Exception as error:  # noqa: BLE001 - report the failing line only, no data
    tb = error.__traceback__
    while tb and tb.tb_next:
        tb = tb.tb_next
    result = {"passed": False, "completedChecks": len(checks), "checks": checks, "timings": timings, "errorType": type(error).__name__,
              "line": tb.tb_lineno if tb else None, "message": str(error)[:160] if isinstance(error, AssertionError) else None}
print(json.dumps(result, ensure_ascii=False), flush=True)
sys.exit(0 if result["passed"] else 1)
