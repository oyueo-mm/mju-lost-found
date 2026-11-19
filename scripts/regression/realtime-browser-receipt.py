"""Check the operator Snippet on the actual chat page using isolated Preview credentials."""
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


config = json.loads(sys.stdin.readline())
base, room = config["base"], config["roomId"]
assert base == "http://localhost:3102" and isinstance(room, int)
snippet_file = Path(__file__).resolve().parents[1] / "operations" / "realtime-browser-receipt.js"
checks = []
token_statuses = []
outputs = []
acknowledged = set()
app_receipt = config.get("appReceipt", False)
prefix = "[MJU Realtime] "


def wait_until(page, condition, timeout):
    deadline = time.monotonic() + timeout
    while not condition() and time.monotonic() < deadline:
        page.wait_for_timeout(100)
    assert condition()


def verify_receipt(page):
    print("operator-receipt", flush=True)
    nonce = json.loads(sys.stdin.readline()).get("nonce", "")
    assert re.fullmatch(r"[0-9a-f-]{36}", nonce)
    if app_receipt:
        wait_until(page, lambda: nonce in acknowledged, 10)
    else:
        wait_until(page, lambda: f"{prefix}RECEIVED {nonce}" in outputs, 10)
    return nonce


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        context.add_cookies([{"name": "authjs.session-token", "value": config["cookies"][0], "url": base}])
        page = context.new_page()
        endpoint = f"{base}/api/chat/{room}/realtime"

        def observe_response(response):
            if response.url == endpoint and response.request.method == "POST":
                receipt = response.request.headers.get("x-mju-realtime-receipt")
                if receipt:
                    if response.status == 204:
                        acknowledged.add(receipt)
                else:
                    token_statuses.append(response.status)

        def observe_console(message):
            if message.text.startswith(prefix):
                outputs.append(message.text)

        page.on("response", observe_response)
        page.on("console", observe_console)
        page.route(endpoint, lambda route: route.fulfill(status=503, json={}))
        print("stage:polling", flush=True)
        page.goto(f"{base}/chat/{room}")
        wait_until(page, lambda: 503 in token_statuses, 30)
        if not app_receipt:
            page.evaluate(snippet_file.read_text(encoding="utf-8"))
            assert f"{prefix}READY" in outputs
        checks.append("Chat loads while token requests fail")

        page.unroute(endpoint)
        print("stage:initial", flush=True)
        wait_until(page, lambda: 200 in token_statuses and (app_receipt or f"{prefix}JOIN OK" in outputs), 50)
        if app_receipt:
            expect(page.get_by_test_id("chat-connection-status")).to_be_empty(timeout=15000)
        checks.append("Existing tab recovers from polling without reload")
        joined_at = time.monotonic()
        initial = verify_receipt(page)
        checks.append("Authorized browser confirms the initial matching receipt")

        print("stage:renewal", flush=True)
        wait_until(page, lambda: time.monotonic() - joined_at >= 125, 130)
        assert token_statuses.count(200) >= 2 and (app_receipt or outputs.count(f"{prefix}JOIN OK") >= 2)
        checks.append("Browser reports a new private join beyond the initial token expiry")
        assert verify_receipt(page) != initial
        checks.append("Authorized browser confirms receipt on the renewed socket")
        assert all(re.fullmatch(r"\[MJU Realtime\] (READY|JOIN OK|RECEIVED [0-9a-f-]{36})", line) for line in outputs)
        checks.append("Diagnostic output contains no token, topic, or raw frame")
        browser.close()
    print("stage:completed", flush=True)
    print(json.dumps({"suite": "D3 automatic browser receipt" if app_receipt else "D3 browser receipt snippet", "passed": len(checks), "checks": checks}))
except Exception as error:
    print(json.dumps({"completedChecks": checks, "errorType": type(error).__name__, "line": error.__traceback__.tb_lineno,
                      "counters": {"tokenStatuses": token_statuses, "diagnosticLines": len(outputs)}}))
    sys.exit(1)
