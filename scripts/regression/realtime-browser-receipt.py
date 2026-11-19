"""Check the operator Snippet on the actual chat page using isolated Preview credentials."""
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


config = json.loads(sys.stdin.readline())
base, room = config["base"], config["roomId"]
assert base == "http://localhost:3102" and isinstance(room, int)
snippet_file = Path(__file__).resolve().parents[1] / "operations" / "realtime-browser-receipt.js"
checks = []
token_statuses = []
outputs = []
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
        page.evaluate(snippet_file.read_text(encoding="utf-8"))
        assert f"{prefix}READY" in outputs
        checks.append("Snippet installed after chat loads in polling mode")

        page.unroute(endpoint)
        print("stage:initial", flush=True)
        wait_until(page, lambda: 200 in token_statuses and f"{prefix}JOIN OK" in outputs, 50)
        checks.append("Existing tab joins private Realtime without reload")
        joined_at = time.monotonic()
        initial = verify_receipt(page)
        checks.append("Console displays only the initial matching receipt nonce")

        print("stage:renewal", flush=True)
        wait_until(page, lambda: time.monotonic() - joined_at >= 125, 130)
        assert token_statuses.count(200) >= 2 and outputs.count(f"{prefix}JOIN OK") >= 2
        checks.append("Browser reports a new private join beyond the initial token expiry")
        assert verify_receipt(page) != initial
        checks.append("Console displays the matching nonce on the renewed socket")
        assert all(re.fullmatch(r"\[MJU Realtime\] (READY|JOIN OK|RECEIVED [0-9a-f-]{36})", line) for line in outputs)
        checks.append("Diagnostic output contains no token, topic, or raw frame")
        browser.close()
    print("stage:completed", flush=True)
    print(json.dumps({"suite": "D3 browser receipt snippet", "passed": len(checks), "checks": checks}))
except Exception as error:
    print(json.dumps({"completedChecks": checks, "errorType": type(error).__name__, "line": error.__traceback__.tb_lineno,
                      "counters": {"tokenStatuses": token_statuses, "diagnosticLines": len(outputs)}}))
    sys.exit(1)
