"""Browser check of the 관리 권한 설정 UI on the fixed Preview address (fixture accounts only).
Run after `node scripts/adminPermissionsPreview.mjs setup`:  python scripts/adminPermissionsPreviewUi.py
The protection-bypass key and session cookies never get printed."""
import asyncio, json, re, subprocess, sys
from pathlib import Path
from urllib.parse import quote
from playwright.async_api import async_playwright

BASE = "https://mju-lost-found-preview.vercel.app"
data = json.loads(Path(".vercel/permission-fixtures.json").read_text(encoding="utf-8"))
out = subprocess.run("npx vercel api /v9/projects/prj_zMYrrsw80l829lSjs2n2Ur6YV5eP --scope oyueo", shell=True, capture_output=True, text=True, env={**__import__("os").environ, "MSYS_NO_PATHCONV": "1"}).stdout
bypass = next(iter(json.loads(out[out.index("{"):])["protectionBypass"]))
checks = []

def check(name, ok, detail=""):
    checks.append(ok)
    print("PASS" if ok else "FAIL", name, "" if ok else detail, flush=True)

async def context(browser, kind, width=1280, height=900):
    c = await browser.new_context(locale="ko-KR", viewport={"width": width, "height": height}, extra_http_headers={"x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "samesitenone"})
    await c.add_cookies([{"name": "__Secure-authjs.session-token", "value": data["cookies"][kind], "domain": "mju-lost-found-preview.vercel.app", "path": "/", "secure": True, "httpOnly": True, "sameSite": "Lax"},
                         {"name": "locale", "value": "ko", "domain": "mju-lost-found-preview.vercel.app", "path": "/"}])
    return c

async def overflow(page):
    return await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")

async def main():
    subject = data["users"]["subject"]
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        errors = []
        for width in (1280, 390):
            ctx = await context(browser, "super", width)
            page = await ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.goto(f"{BASE}/admin/users?q={quote(subject['email'])}")
            check(f"[{width}] user list shows the subject", await page.get_by_text(subject["email"]).count() > 0)
            await page.get_by_role("button", name="관리 권한 설정").first.click()
            check(f"[{width}] editor shows presets", await page.get_by_role("button", name="물품 관리 담당").count() == 1 and await page.get_by_text("직접 설정").count() >= 1)
            check(f"[{width}] 권한 관리 checkbox is locked", await page.get_by_label(re.compile("권한 관리 .*전체 관리자 전용")).is_disabled())
            check(f"[{width}] no horizontal overflow", await overflow(page) <= 1, str(await overflow(page)))
            await page.screenshot(path=f".vercel/permissions-editor-{width}.png", full_page=True)
            await ctx.close()

        # --- grant the 물품 관리 담당 preset through the UI, then extend it by hand
        ctx = await context(browser, "super")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(f"{BASE}/admin/users/{subject['id']}")
        await page.get_by_role("button", name="관리 권한 설정").click()
        await page.get_by_role("button", name="물품 관리 담당").click()
        org = data["organizations"][0]
        await page.get_by_label(re.compile("^담당 기관")).select_option(str(org["id"]))
        summary = await page.locator("[aria-live=polite]").inner_text()
        check("summary lists the four preset permissions", all(x in summary for x in ["물품 접수", "보관 관리", "물품 반환", "기관 인계"]), summary)
        await page.locator("summary", has_text="통계").click()
        await page.get_by_label(re.compile("^관리자 통계 조회")).check()
        check("editing after a preset switches to 직접 설정", await page.get_by_text("직접 설정", exact=True).first.get_attribute("aria-pressed") == "true")
        save = page.get_by_role("button", name="변경사항 저장")
        check("save is disabled until the change is confirmed", await save.is_disabled())
        await page.get_by_label(re.compile("변경 사유")).fill("브라우저 검증")
        await page.get_by_label(re.compile("위 변경 내용과 대상 계정")).check()
        await save.click()
        await page.wait_for_selector("text=관리 권한을 저장했습니다", timeout=20000)
        check("saved with an immediate-effect notice", True)
        await page.screenshot(path=".vercel/permissions-saved-1280.png", full_page=True)
        await ctx.close()

        # --- the subject now has the permissions (same session cookie, next request)
        ctx = await context(browser, "subject")
        page = await ctx.new_page()
        await page.goto(BASE + "/")
        check("subject sees the single 관리자 menu", await page.locator('a[href="/admin"]').count() > 0)
        await page.goto(BASE + "/admin")
        body = await page.inner_text("body")
        check("admin center shows the items entry, not users/reports", "기관 물품 현황" in body and "전체 사용자" not in body and "신고 대기" not in body)
        r = await page.goto(BASE + "/admin/reports")
        check("direct URL to a page without permission leaves /admin/reports", "/admin/reports" not in page.url, page.url)
        resp = await ctx.request.get(BASE + "/api/admin/users")
        check("API without the permission is refused", resp.status == 403, str(resp.status))
        await page.goto(BASE + "/items")
        check("/items opens", "물품 관리" in await page.inner_text("body"))
        await ctx.close()

        # --- revoke everything through the UI; the same session stops working at once
        ctx = await context(browser, "super")
        page = await ctx.new_page()
        await page.goto(f"{BASE}/admin/users/{subject['id']}")
        await page.get_by_role("button", name="관리 권한 설정").click()
        page.once("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await page.get_by_role("button", name="권한 전체 회수").click()
        await page.wait_for_selector("text=관리 권한을 저장했습니다", timeout=20000)
        check("revoked through the UI", True)
        await ctx.close()
        ctx = await context(browser, "subject")
        page = await ctx.new_page()
        await page.goto(BASE + "/")
        check("after revoking, the 관리자 menu is gone with the old session", await page.locator('a[href="/admin"]').count() == 0)
        r = await page.goto(BASE + "/items")
        check("after revoking, /items no longer exists for them", r.status == 404, str(r.status))
        resp = await ctx.request.patch(f"{BASE}/api/posts/{data['posts'][1]}?type=found", data={"management": {"action": "complete", "expectedUpdatedAt": "2026-01-01T00:00:00.000Z", "confirmed": True}})
        check("after revoking, the item API refuses the same session", resp.status == 403, str(resp.status))
        await ctx.close()

        # --- accounts without 권한 관리 never see the editor
        ctx = await context(browser, "usersSanction")
        page = await ctx.new_page()
        await page.goto(f"{BASE}/admin/users?q={quote(subject['email'])}")
        check("users.sanction holder cannot open the permission editor", await page.get_by_role("button", name="관리 권한 설정").count() == 0)
        check("users.sanction holder sees the suspend button", await page.get_by_role("button", name="정지").count() > 0)
        await ctx.close()
        ctx = await context(browser, "usersView")
        page = await ctx.new_page()
        await page.goto(f"{BASE}/admin/users?q={quote(subject['email'])}")
        check("users.view holder sees neither the editor nor the suspend button", await page.get_by_role("button", name="관리 권한 설정").count() == 0 and await page.get_by_role("button", name="정지", exact=True).count() == 0)
        await ctx.close()
        check("no page errors", not errors, "; ".join(errors[:3]))
        await browser.close()
    print(f"{sum(checks)}/{len(checks)} browser checks passed")
    sys.exit(0 if all(checks) else 1)

asyncio.run(main())
