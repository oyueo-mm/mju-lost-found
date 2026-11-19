"""Read-only visual checks on a hosted origin.

Checks (1440 / 390 / 320 px): the common header shows only the short name
"분실물 센터" with no logo and nothing overlapping, the home headline is the
full service name, the subtitle and the campus-partners note are present and
make no official claim, card order (lost left / found right), no horizontal
scroll, the header on other pages, and the optional subcategory.

Default: the fixed Preview, which needs a Preview protection cookie jar at
.vercel/ux-visual-preview.cookies. Set HOSTED_UX_ORIGIN=https://mju-find.vercel.app
to check the public Production pages instead (no cookies are read or sent).
Screenshots go to .vercel/ux-<label>-*.png (gitignored).
"""
import json
import os
from urllib.parse import urlparse
from http.cookiejar import MozillaCookieJar
from playwright.sync_api import expect, sync_playwright

origin = os.environ.get("HOSTED_UX_ORIGIN", "https://mju-lost-found-preview.vercel.app").rstrip("/")
host = urlparse(origin).hostname
use_cookies = host == "mju-lost-found-preview.vercel.app"
label = os.environ.get("HOSTED_UX_LABEL") or ("preview" if use_cookies else "hosted")
brand = "명지대학교 분실물 센터"
header_name = "분실물 센터"
subtitle = "교내 분실물과 습득물을 한곳에서 찾아보세요."
partners = "학생지원팀·교목팀·교내 경비실과 협력하는 분실물 서비스"
empty = "잘 모르겠어요 (선택 안 함)"
jar = MozillaCookieJar(".vercel/ux-visual-preview.cookies")
if use_cookies:
    jar.load(ignore_discard=True)


def no_overflow(page):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "horizontal scroll"


def check_header(page, width, path):
    header = page.locator("header").first
    expect(header).to_be_visible()
    link = header.locator('a[href="/"]').first
    expect(link).to_have_text(header_name)
    assert link.get_attribute("aria-label") == brand
    # no brand mark: the home link holds text only
    assert link.locator("svg, img").count() == 0, f"logo still in header on {path}"
    box = link.bounding_box()
    hb = header.bounding_box()
    assert hb["height"] <= 72, f"header too tall on {path}: {hb['height']}"
    # nothing else in the header may overlap the name
    for el in header.locator("a, button").all():
        if el.evaluate("(e, l) => e === l || l.contains(e)", link.element_handle()):
            continue
        if not el.is_visible():
            continue
        b = el.bounding_box()
        overlap = not (b["x"] >= box["x"] + box["width"] - 0.5 or b["x"] + b["width"] <= box["x"] + 0.5 or b["y"] >= box["y"] + box["height"] or b["y"] + b["height"] <= box["y"])
        assert not overlap, f"header overlap on {path} at {width}px"
    return hb["height"]


with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in [(1440, 900), (390, 844), (320, 750)]:
        ctx = browser.new_context(viewport={"width": width, "height": height}, locale="ko-KR")
        if use_cookies:
            ctx.add_cookies([{"url": origin, "name": c.name, "value": c.value} for c in jar if c.domain == host and c.name == "_vercel_jwt"])
        page = ctx.new_page()
        page.goto(origin)
        assert page.title().startswith(brand), page.title()
        header_h = check_header(page, width, "/")
        no_overflow(page)
        h1 = page.locator("h1").first
        assert h1.inner_text().replace("\n", " ").split() == brand.split(), h1.inner_text()
        lines = page.evaluate("h => Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight))", h1.element_handle())
        assert lines == (2 if width < 768 else 1), f"headline lines={lines} at {width}px"
        assert page.evaluate("parseFloat(getComputedStyle(document.querySelector('h1')).fontSize)") >= 28
        expect(page.get_by_text(subtitle, exact=True)).to_be_visible()
        assert h1.bounding_box()["y"] < page.get_by_text(subtitle, exact=True).bounding_box()["y"]
        nav = page.locator('nav.grid-cols-2:has(a[href="/lost/new"]) > a')
        assert [a.get_attribute("href") for a in nav.all()] == ["/lost/new", "/found/new", "/lost", "/found"]
        boxes = [a.bounding_box() for a in nav.all()]
        assert boxes[0]["x"] < boxes[1]["x"] and boxes[2]["x"] < boxes[3]["x"]
        search = page.locator("#landing-hero-cta")
        expect(search).to_be_visible()
        assert search.locator("input, textarea").count() >= 1, "home search input missing"
        section = page.locator("#campus-partners-title")
        section.scroll_into_view_if_needed()
        expect(section).to_be_visible()
        body = page.get_by_text(partners, exact=True)
        expect(body).to_be_visible()
        text = section.locator("xpath=..").inner_text()
        assert not any(w in text for w in ["공식", "지정", "직영"]), text
        assert section.locator("xpath=..").locator("img, svg").count() == 0
        assert page.locator('section:has(#campus-partners-title) a[href="/policy/community"]').count() == 1
        no_overflow(page)
        page.screenshot(path=f".vercel/ux-{label}-home-{width}.png")
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=f".vercel/ux-{label}-home-top-{width}.png")
        for path in ["/lost", "/found", "/search"]:
            page.goto(origin + path)
            check_header(page, width, path)
            no_overflow(page)
        page.goto(origin + "/found")
        page.screenshot(path=f".vercel/ux-{label}-found-{width}.png")
        page.goto(origin + "/found?categoryCode=electronics")
        sub = page.get_by_role("combobox", name="소분류", exact=True).first
        expect(sub).to_be_visible()
        expect(sub.locator("option").first).to_have_text(empty)
        assert sub.input_value() == "" and not sub.evaluate("s => s.required")
        sub.scroll_into_view_if_needed()
        page.screenshot(path=f".vercel/ux-{label}-subcategory-{width}.png")
        print(json.dumps({"origin": origin, "viewport": width, "headerHeight": header_h, "headlineLines": lines, "home": True, "otherPagesHeader": True, "firstOptionalChoice": True}))
        ctx.close()
    browser.close()
