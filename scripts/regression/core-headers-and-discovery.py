"""Read-only Chromium smoke on a locally started Preview build (port 3106)."""
import json
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


BASE = "http://127.0.0.1:3106"
HEADERS = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "geolocation=(), microphone=(), payment=(), usb=()",
}
checks = []

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(locale="ko-KR", viewport={"width": 390, "height": 844})
    for path in ("/", "/login", "/api/version", "/sw.js"):
        response = context.request.get(BASE + path)
        assert response.ok and all(response.headers.get(name) == value for name, value in HEADERS.items()), path
    checks.append("home, login, API, and service worker deliver the four headers")

    page = context.new_page()
    frame_errors = []
    page.on("console", lambda message: frame_errors.append(message.text) if message.type == "error" else None)
    page.set_content(f'<iframe src="{BASE}/login"></iframe>')
    for _ in range(50):
        if any("x-frame-options" in error.lower() for error in frame_errors):
            break
        page.wait_for_timeout(100)
    assert any("x-frame-options" in error.lower() for error in frame_errors)
    checks.append("Chromium refuses to frame the login page")

    page.goto(BASE)
    navigation = page.locator('nav.grid-cols-2:has(a[href="/lost/new"]):has(a[href="/found/new"])')
    links = navigation.locator(":scope > a")
    expect(links).to_have_count(4)
    assert [link.get_attribute("href") for link in links.all()] == ["/lost/new", "/found/new", "/lost", "/found"]
    assert links.nth(0).bounding_box()["y"] == links.nth(1).bounding_box()["y"] < links.nth(2).bounding_box()["y"]
    assert links.nth(0).bounding_box()["x"] == links.nth(2).bounding_box()["x"]
    assert links.nth(1).bounding_box()["x"] == links.nth(3).bounding_box()["x"]
    checks.append("lost actions are on the left and found actions are on the right on a phone")

    expect(page.locator('meta[name="robots"]')).to_have_attribute("content", "noindex, nofollow")
    assert "명지대학교 분실물·습득물 찾기" in page.title()
    assert page.title().startswith("명지대학교 분실물 센터")
    manifest = context.request.get(BASE + "/manifest.webmanifest").json()
    assert manifest["short_name"] == "명지대학교 분실물 센터"
    structured = page.locator('script[type="application/ld+json"]').text_content()
    assert json.loads(structured)["name"] == "명지대학교 분실물 센터"
    assert json.loads(structured)["alternateName"] == "MJU Find"
    assert "Disallow: /" in context.request.get(BASE + "/robots.txt").text()
    assert "<loc>" not in context.request.get(BASE + "/sitemap.xml").text()
    checks.append("site title and Preview crawler settings render as intended")
    for asset in ("/icon.svg", "/apple-icon.png", "/opengraph-image.png", *(icon["src"] for icon in manifest["icons"])):
        response = context.request.get(BASE + asset)
        assert response.ok and response.headers["content-type"].startswith("image/"), asset
    checks.append("favicon, home-screen icons, and link-share artwork load")

    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(BASE + "/found")
    assert "습득물" in page.title() and "명지대학교 분실물 센터" in page.title()
    canonical = urlparse(page.locator('link[rel="canonical"]').get_attribute("href"))
    assert canonical.path == "/found" and canonical.hostname in ("localhost", "mju-find.vercel.app")
    category = page.locator('select[aria-label="카테고리"]').first
    subcategory = page.locator('select[aria-label="소분류"]').first
    expect(subcategory).to_be_visible()
    expect(subcategory).to_be_disabled()
    expect(subcategory.locator("option").first).to_have_text("대분류를 먼저 선택하세요")
    category.select_option("electronics")
    expect(subcategory).to_be_enabled()
    expect(subcategory.locator("option", has_text="노트북")).to_have_count(1)
    category.select_option("")
    expect(subcategory).to_be_disabled()
    checks.append("subcategory stays visible, activates after the parent, and resets when cleared")
    browser.close()

print(json.dumps({"suite": "D4 headers and discovery Chromium", "passed": len(checks), "checks": checks}))
