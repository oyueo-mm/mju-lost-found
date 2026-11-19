"""Signed-in header checks (1440 / 390 / 320 px) against HEADER_BASE using the
synthetic session cookie in HEADER_SESSION. Called by logged-in-header.mjs."""
import json
import os
from playwright.sync_api import expect, sync_playwright

base = os.environ["HEADER_BASE"]
session = os.environ["HEADER_SESSION"]
brand = "명지대학교 분실물 센터"
short = "분실물 센터"


def overlap(a, b):
    return not (a["x"] >= b["x"] + b["width"] - 0.5 or a["x"] + a["width"] <= b["x"] + 0.5 or a["y"] >= b["y"] + b["height"] or a["y"] + a["height"] <= b["y"])


with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in [(1440, 900), (390, 844), (320, 750)]:
        ctx = browser.new_context(viewport={"width": width, "height": height}, locale="ko-KR")
        ctx.add_cookies([{"name": "authjs.session-token", "value": session, "url": base}])
        page = ctx.new_page()
        page.goto(base)
        header = page.locator("header").first
        expect(header).to_be_visible()
        name = header.locator('a[href="/"]').first
        expect(name).to_have_text(short)
        assert name.get_attribute("aria-label") == brand
        assert name.locator("svg, img").count() == 0
        bell = header.locator('a[href="/notifications"]:visible').first
        expect(bell).to_be_visible()
        label = bell.get_attribute("aria-label") or ""
        search = header.locator('a[href="/search"]:visible').first
        expect(search).to_be_visible()
        # the unread count is on screen (the synthetic member has one)
        badge = bell.locator("span")
        assert badge.count() >= 1 and badge.first.is_visible(), "unread badge not shown"
        # profile control: the header's account dropdown on every width, plus the bottom-nav tab on phones
        profile = header.locator('a[href="/me"]:visible').first
        expect(profile).to_be_visible()
        if width < 768:
            expect(page.locator('nav a[href="/me"]:visible').last).to_be_visible()
        visible = [header.locator(s).first for s in ('a[href="/"]', 'a[href="/search"]:visible', 'a[href="/notifications"]:visible', 'a[href="/me"]:visible')]
        boxes = [v.bounding_box() for v in visible]
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                assert not overlap(boxes[i], boxes[j]), f"header controls overlap at {width}px"
        assert header.bounding_box()["height"] <= 72
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "horizontal scroll"
        page.screenshot(path=f".vercel/ux-loggedin-header-{width}.png", clip={"x": 0, "y": 0, "width": width, "height": 140})
        print(json.dumps({"viewport": width, "name": True, "bell": True, "badge": True, "profileInHeader": True, "bellLabel": label, "noOverlap": True, "noHorizontalScroll": True}, ensure_ascii=False))
        ctx.close()
    browser.close()
