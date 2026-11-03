"""Exercise the actual receipt/transfer/return form using Preview-only fixtures."""
import asyncio, json
from pathlib import Path
from http.cookiejar import MozillaCookieJar
from playwright.async_api import async_playwright, expect

BASE = 'https://mju-lost-found-preview.vercel.app'

async def main():
    data = json.loads(Path('.vercel/institution-fixtures.json').read_text(encoding='utf-8'))
    assert data['marker'].startswith('institution-test-')
    jar = MozillaCookieJar('.vercel/institution-protection.cookies')
    jar.load(ignore_discard=True, ignore_expires=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        contexts = {}
        for role in ['officerA', 'officerB']:
            context = await browser.new_context(base_url=BASE, locale='ko-KR', viewport={'width':390, 'height':900})
            await context.add_cookies([{'name':c.name,'value':c.value,'domain':c.domain,'path':c.path,'secure':c.secure} for c in jar] + [
                {'name':'locale','value':'ko','domain':'mju-lost-found-preview.vercel.app','path':'/'},
                {'name':'__Secure-authjs.session-token','value':data['users'][role]['cookie'],'domain':'mju-lost-found-preview.vercel.app','path':'/','secure':True}])
            contexts[role] = context
        endpoint = f"/api/posts/{data['posts'][1]}?type=found"
        detail = f"/post/{data['posts'][1]}?type=found"
        async def item():
            return (await (await contexts['officerA'].request.get(endpoint)).json())['data']
        async def manage(role, action, **fields):
            current = await item()
            return await contexts[role].request.patch(endpoint, data={'management':{'action':action,'confirmed':True,'expectedUpdatedAt':current['updatedAt'],**fields}})
        if not (await item())['custodyOrganizationId']:
            assert (await manage('officerA','confirm',place='Preview A reception')).status == 200
        if not (await item())['pendingTransferOrganizationId']:
            assert (await manage('officerA','transfer_request',organizationId=data['organizations'][1]['id'])).status == 200
        a = await contexts['officerA'].new_page()
        await a.goto(detail, wait_until='load')
        await expect(a.get_by_role('combobox',name='처리 내용',exact=True)).to_have_value('location')
        await expect(a.get_by_label('실제 보관 장소',exact=True)).to_be_visible()
        print('Pending sender UI defaults to location and requests a real storage place.',flush=True)
        b = await contexts['officerB'].new_page()
        await b.goto(detail,wait_until='load')
        await b.wait_for_timeout(1000)
        await expect(b.get_by_role('combobox',name='처리 내용',exact=True)).to_have_value('transfer_accept')
        await b.get_by_label('실제 보관 장소',exact=True).fill('Preview B reception')
        await b.get_by_label('소속 기관에서 실물을 실제 접수·보관 중임을 확인했습니다.',exact=True).check()
        async with b.expect_response(lambda r:r.request.method=='PATCH' and '/api/posts/' in r.url) as response:
            await b.get_by_role('button',name='처리 저장',exact=True).click()
        assert (await response.value).status == 200
        assert (await item())['custodyOrganizationId'] == data['organizations'][1]['id']
        print('The receiving agency accepts a real handover through the mobile form.',flush=True)
        await b.goto(detail,wait_until='load')
        await b.wait_for_timeout(1000)
        await expect(b.get_by_role('combobox',name='처리 내용',exact=True)).to_have_value('complete')
        await b.get_by_label('실제 반환 또는 찾음을 확인했습니다.',exact=True).check()
        async with b.expect_response(lambda r:r.request.method=='PATCH' and '/api/posts/' in r.url) as response:
            await b.get_by_role('button',name='처리 저장',exact=True).click()
        assert (await response.value).status == 200
        assert (await item())['status'] == '완료'
        await b.screenshot(path='.vercel/institution-detail-mobile.png',full_page=True)
        assert await b.evaluate('document.documentElement.scrollWidth <= innerWidth')
        print('The receiving agency returns the item through the mobile form without page overflow.',flush=True)
        await browser.close()

asyncio.run(main())
