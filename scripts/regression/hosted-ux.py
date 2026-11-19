"""Read-only visual checks on the fixed Preview. Run with a Preview protection cookie jar."""
import json
from http.cookiejar import MozillaCookieJar
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

origin = "https://mju-lost-found-preview.vercel.app"
host = "mju-lost-found-preview.vercel.app"
brand = "명지대학교 분실물 센터"
empty = "잘 모르겠어요 (선택 안 함)"
jar = MozillaCookieJar(".vercel/ux-visual-preview.cookies")
jar.load(ignore_discard=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in [(1440, 900), (390, 844), (320, 750)]:
        ctx = browser.new_context(viewport={"width": width, "height": height}, locale="ko-KR")
        ctx.add_cookies([{"url": origin, "name": c.name, "value": c.value} for c in jar if c.domain == host and c.name == "_vercel_jwt"])
        page = ctx.new_page()
        page.goto(origin)
        assert page.title().startswith(brand)
        expect(page.locator("header").get_by_text(brand, exact=True)).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        nav = page.locator('nav.grid-cols-2:has(a[href="/lost/new"]) > a')
        assert [a.get_attribute("href") for a in nav.all()] == ["/lost/new", "/found/new", "/lost", "/found"]
        boxes = [a.bounding_box() for a in nav.all()]
        assert boxes[0]["x"] < boxes[1]["x"] and boxes[2]["x"] < boxes[3]["x"]
        page.screenshot(path=f".vercel/ux-home-{width}.png")
        page.goto(origin + "/found?categoryCode=electronics")
        sub = page.get_by_role("combobox", name="소분류", exact=True).first
        expect(sub).to_be_visible()
        expect(sub.locator("option").first).to_have_text(empty)
        assert sub.input_value() == "" and not sub.evaluate("s => s.required")
        sub.scroll_into_view_if_needed()
        page.screenshot(path=f".vercel/ux-subcategory-{width}.png")
        print(json.dumps({"viewport":width,"home":True,"firstOptionalChoice":True}))
        ctx.close()
    browser.close()
