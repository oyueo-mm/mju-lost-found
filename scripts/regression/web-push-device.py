"""Use the actual Edge Web Push provider and the app service worker."""
import json
import sys
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

config = json.load(sys.stdin)
base, room = config["base"], config["roomId"]
assert base == "http://localhost:3105" and isinstance(room, int)
checks = []

try:
    with TemporaryDirectory(prefix="mju-edge-push-") as profile, sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            profile, channel="msedge", headless=True,
            ignore_default_args=["--disable-background-networking"],
        )
        try:
            context.grant_permissions(["notifications"], origin=base)
            context.add_cookies([{"name": "authjs.session-token", "value": config["cookies"][0], "url": base}])
            page = context.pages[0]
            page.goto(f"{base}/me", timeout=15000)
            toggle = page.get_by_role("switch", name="채팅 푸시 알림")
            expect(toggle).to_be_visible(timeout=10000)
            toggle.click()
            expect(toggle).to_have_attribute("aria-checked", "true", timeout=25000)
            checks.append("device registers a real Edge push subscription through app settings")

            peer = playwright.request.new_context(extra_http_headers={
                "cookie": f"authjs.session-token={config['cookies'][1]}",
                "origin": base,
            })
            try:
                response = peer.post(f"{base}/api/chat/{room}/messages", data={"content": "Isolated web push fixture"})
                assert response.ok
            finally:
                peer.dispose()
            checks.append("other fixture account sends a chat message")

            notification_matches = """async room => {
                const reg = await navigator.serviceWorker.getRegistration('/');
                const notices = await reg.getNotifications({tag: `chat-${room}`});
                if (notices.length !== 1) return false;
                const [notice] = notices;
                return notice.title === '명지대학교 분실물 센터' && notice.body === '새로운 채팅 메시지가 도착했어요.' &&
                       notice.data?.url === `/chat/${room}`;
            }"""
            received = False
            for _ in range(70):
                received = page.evaluate(notification_matches, room)
                if received:
                    break
                page.wait_for_timeout(500)
            assert received
            checks.append("the real push reaches Edge and the worker shows the expected notification")

            toggle.click()
            expect(toggle).to_have_attribute("aria-checked", "false", timeout=10000)
            assert page.evaluate("""async () => !(await (await navigator.serviceWorker.getRegistration('/')).pushManager.getSubscription())""")
            checks.append("the real test browser unsubscribes")
        finally:
            context.close()
    print(json.dumps({"suite": "Windows Edge real Web Push", "passed": len(checks), "checks": checks, "osNotificationClickVerified": False}))
except Exception as error:
    print(json.dumps({"checks": checks, "errorType": type(error).__name__, "line": error.__traceback__.tb_lineno}))
    sys.exit(1)
