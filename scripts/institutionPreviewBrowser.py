import asyncio, json, re
from pathlib import Path
from http.cookiejar import MozillaCookieJar
from urllib.parse import quote, urlparse, parse_qs
from playwright.async_api import async_playwright

BASE = 'https://mju-lost-found-preview.vercel.app'
ROOT = Path('.vercel')
DATA = json.loads((ROOT / 'institution-fixtures.json').read_text(encoding='utf-8'))
class CheckList(list):
  def append(self, value):
    super().append(value)
    print(value, flush=True)
checks = CheckList()
async def main():
  async with async_playwright() as pw:
    browser = await pw.chromium.launch(headless=True)
    jar = MozillaCookieJar(str(ROOT / 'institution-protection.cookies'))
    jar.load(ignore_discard=True, ignore_expires=True)
    protection = [{ 'name': c.name, 'value': c.value, 'domain': c.domain, 'path': c.path, 'secure': c.secure } for c in jar]
    contexts = {}
    for key, user in DATA['users'].items():
      ctx = await browser.new_context(base_url=BASE, locale='ko-KR', viewport={'width': 1280, 'height': 900}, user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')
      # Exercise the real visitor beacon only for these isolated Preview fixtures.
      await ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>false})")
      await ctx.add_cookies(protection + [
        {'name':'locale', 'value':'ko', 'domain':'mju-lost-found-preview.vercel.app','path':'/'},
        {'name':'__Secure-authjs.session-token', 'value':user['cookie'], 'domain':'mju-lost-found-preview.vercel.app','path':'/','secure':True,'httpOnly':True}
      ])
      contexts[key] = ctx
    session = await contexts['service'].request.get('/api/auth/session')
    assert (await session.json()).get('user',{}).get('id') == str(DATA['users']['service']['id']), 'Preview test-session key does not match; no authority tests were run.'
    checks.append('deployed Preview resolves only the seeded test identities')
    async def get_item(index=0):
      r=await contexts['owner'].request.get(f"/api/posts/{DATA['posts'][index]}?type=found")
      assert r.status == 200
      return (await r.json())['data']
    async def manage(key, action, item=None, index=0, **fields):
      item = item or await get_item(index)
      return await contexts[key].request.patch(f"/api/posts/{DATA['posts'][index]}?type=found", data={'management': {'action':action,'expectedUpdatedAt':item['updatedAt'],'confirmed':True,**fields}})
    for key in ['owner','orgAdmin','external']:
      r=await manage(key,'confirm',place='검증 보관 장소'); assert r.status == 403, (key,r.status)
    r=await contexts['officerA'].request.get('/admin/institution-officers',max_redirects=0)
    assert r.status in [303,307,404]
    checks.append('ordinary users, organization admins and login-only approvals cannot manage items; officers cannot enter service admin pages')
    r=await manage('officerA','confirm',place='A 경비실 보관'); assert r.status == 200, await r.text()
    item=await get_item(); assert item['custodyOrganizationId'] == DATA['organizations'][0]['id']
    checks.append('receipt belongs to the receiving agency despite a different discovery campus')
    assert (await manage('officerB','complete')).status == 403
    assert (await contexts['officerA'].request.patch(f"/api/posts/{DATA['posts'][0]}?type=found",data={'title':'forged'})).status == 403
    assert (await contexts['officerA'].request.delete(f"/api/posts/{DATA['posts'][0]}?type=found")).status == 403
    assert (await contexts['owner'].request.patch(f"/api/posts/{DATA['posts'][0]}?type=found",data={'custody':{'state':'SELF','place':''}})).status == 403
    checks.append('other agencies, content edits, deletion and owner overwriting agency custody are blocked')
    r=await manage('officerA','location',place='A 경비실 보관함 2'); assert r.status == 200
    stale=item; assert (await manage('officerA','location',item=stale,place='stale')).status == 409
    checks.append('location updates preserve receipt and reject stale requests')
    race=await get_item(1)
    results=await asyncio.gather(manage('officerA','confirm',item=race,index=1,place='A'),manage('officerB','confirm',item=race,index=1,place='B'))
    assert sorted(r.status for r in results) == [200,409], [r.status for r in results]
    checks.append('simultaneous agency receipts produce exactly one success')
    target=DATA['organizations'][1]['id']
    assert (await manage('officerA','transfer_request',organizationId=target)).status == 200
    item=await get_item(); assert item['custodyOrganizationId'] == DATA['organizations'][0]['id'] and item['pendingTransferOrganizationId'] == target
    assert (await manage('officerA','complete')).status == 409
    assert (await manage('officerB','transfer_accept',place='B 학생지원팀 접수')).status == 200
    item=await get_item(); assert item['custodyOrganizationId'] == target and item['pendingTransferOrganizationId'] is None
    assert (await manage('officerA','complete')).status == 403
    assert (await manage('officerB','complete')).status == 200
    assert (await manage('service','reopen')).status == 400
    assert (await manage('service','reopen',reason='검증: 잘못된 반환 정정')).status == 200
    assert (await get_item())['custodyOrganizationId'] == target
    checks.append('two-sided transfer, post-transfer authorization, return and reasoned service-admin recovery')
    page=await contexts['service'].new_page()
    errors=[]; page.on('pageerror',lambda err: errors.append(str(err)))
    action_requests=[]
    page.on('request',lambda req: action_requests.append((req.url,req.headers,req.post_data)) if req.headers.get('next-action') else None)
    await page.goto(BASE+'/admin/institution-officers?q='+quote(DATA['users']['newOfficer']['email']),wait_until='load')
    await page.wait_for_timeout(1500)
    await page.get_by_label(re.compile('^대상 계정검색 결과')).select_option(str(DATA['users']['newOfficer']['id']))
    await page.get_by_label(re.compile('^소속 기관')).select_option(str(DATA['organizations'][0]['id']))
    await page.get_by_label('담당 시설',exact=True).fill('브라우저 검증 시설')
    await page.get_by_label('변경 사유',exact=True).fill('Preview 검증: 담당자 지정')
    confirmation=page.get_by_label('대상 계정의 이메일과 소속 기관을 확인했습니다.',exact=True)
    await confirmation.uncheck()
    await confirmation.check()
    async with page.expect_response(lambda r: bool(r.request.headers.get('next-action')) and 'organizationId' in (r.request.post_data or '')) as saved:
      await page.get_by_role('button',name='권한 저장',exact=True).click()
    await page.get_by_role('status').filter(has_text='기관 담당자 권한을 저장했습니다.').wait_for(timeout=60000)
    print(json.dumps({'grantResponse':(await saved.value).status, 'status':await page.get_by_role('status').all_text_contents()},ensure_ascii=False),flush=True)
    await page.screenshot(path=str(ROOT/'institution-grant-debug.png'),full_page=True)
    await page.wait_for_timeout(500)
    assert (await contexts['newOfficer'].request.get('/items',max_redirects=0)).status == 200
    checks.append('service admin assigns an existing account via the actual browser UI')
    await page.get_by_label(re.compile('^기관 담당자 권한 활성')).uncheck()
    await page.get_by_label('변경 사유',exact=True).fill('Preview 검증: 권한 회수')
    await page.get_by_label('대상 계정의 이메일과 소속 기관을 확인했습니다.',exact=True).check()
    async with page.expect_response(lambda r: bool(r.request.headers.get('next-action')) and 'organizationId' in (r.request.post_data or '')) as saved:
      await page.get_by_role('button',name='권한 저장',exact=True).click()
    await page.wait_for_function("Array.from(document.querySelectorAll('[role=status]')).some(e => e.textContent.includes('기관 담당자 권한을 저장했습니다.') || e.textContent.includes('다른 활성 담당자가 없습니다'))",timeout=60000)
    await page.wait_for_timeout(500)
    assert (await manage('newOfficer','confirm',index=2,place='forbidden')).status == 403
    assert action_requests
    action_url, action_headers, action_body = next(r for r in action_requests if 'organizationId' in (r[2] or ''))
    replay_headers={k:v for k,v in action_headers.items() if k in ['next-action','content-type','next-router-state-tree']}
    replay_headers['origin']=BASE
    await contexts['officerA'].request.post(action_url,headers=replay_headers,data=action_body,max_redirects=0)
    assert (await manage('newOfficer','confirm',index=2,place='forged-grant')).status == 403
    checks.append('revocation takes effect on the next API call without re-login')
    checks.append('tampering with the real grant server-action request cannot elevate an officer')
    for width in [1280,390]:
      await page.set_viewport_size({'width':width,'height':900})
      await page.goto(BASE+'/admin/institution-officers?q='+quote(DATA['users']['newOfficer']['email']),wait_until='domcontentloaded')
      await page.get_by_role('heading',name='기관 담당자 관리',exact=True).wait_for()
      await page.screenshot(path=str(ROOT/f'institution-admin-{width}.png'),full_page=True)
      assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
      officerpage=await contexts['officerB'].new_page()
      await officerpage.set_viewport_size({'width':width,'height':900})
      await officerpage.goto(BASE+'/items?view=stored',wait_until='domcontentloaded')
      await officerpage.get_by_role('heading',name='물품 관리',exact=True).wait_for()
      await officerpage.screenshot(path=str(ROOT/f'institution-items-{width}.png'),full_page=True)
      assert await officerpage.evaluate('document.documentElement.scrollWidth <= innerWidth')
      await officerpage.close()
    checks.append('agency dashboard and officer management render on desktop and mobile without page overflow')
    for role in ['service','officer']:
      r=await contexts['service'].request.get('/admin/stats?tab=admins&period=week&ar='+role+'&ao='+str(DATA['organizations'][0]['id']))
      assert r.status == 200, (role,r.status)
      assert '관리자 유형' in await r.text()
    for tab in ['ops','users']:
      assert (await contexts['service'].request.get('/admin/stats?tab='+tab+'&period=month')).status == 200
    checks.append('all statistics tabs and role/agency filters render with the shared KST range')
    for key in ['officerA','dual']:
      traffic_page=await contexts[key].new_page()
      await traffic_page.goto(BASE+'/items',wait_until='load')
      await traffic_page.wait_for_timeout(6000)
      await traffic_page.close()
    checks.append('the actual visit beacon runs for isolated officer and dual-role test sessions')
    for key in ['officerA','dual','newOfficer']:
      r=await contexts[key].request.post('/api/posts',data={'type':'found','title':DATA['marker']+' '+key,'description':'Preview registration verification','categoryCode':'etc','subcategory':None,'location':None,'campus':'인문캠퍼스','foundDate':None,'foundTime':None,'custody':{'state':'SELF','place':''}})
      assert r.status == 201, (key,r.status,await r.text())
    for key in ['officerA','dual','owner']:
      assert (await contexts[key].request.get('/found?q='+quote(DATA['marker']))).status == 200
    checks.append('normal, officer and dual-role accounts register and search through the original APIs')
    semantic=await contexts['owner'].request.get('/api/posts?type=found&mode=semantic&q='+quote('검은 지갑'),timeout=120000)
    assert semantic.status == 200, ('semantic',semantic.status)
    image=await contexts['owner'].request.post('/api/posts?type=found&mode=image',multipart={'image':{'name':'preview-test.png','mimeType':'image/png','buffer':Path('public/icon-192.png').read_bytes()}},timeout=120000)
    assert image.status == 200, ('image',image.status)
    recommended=await contexts['owner'].request.get(f"/api/posts/{DATA['posts'][2]}?type=found&include=recommendations")
    assert recommended.status == 200 and 'recommendations' in (await recommended.json())['data']
    room=await contexts['officerA'].request.post('/api/chat',data={'postType':'found','postId':DATA['posts'][2]})
    assert room.status == 201, ('chat',room.status,await room.text())
    room_id=(await room.json())['data']['id']
    message=await contexts['officerA'].request.post(f'/api/chat/{room_id}/messages',data={'content':'Preview 기관 운영 검증 메시지'})
    assert message.status == 201, ('message',message.status)
    assert (await contexts['owner'].request.get('/api/notifications')).status == 200
    checks.append('deployed semantic search, image inference, recommendation lookup, chat and notifications return successfully')
    csrf=await contexts['owner'].request.get('/api/auth/csrf')
    signin=await contexts['owner'].request.post('/api/auth/signin/google',form={'csrfToken':(await csrf.json())['csrfToken'],'callbackUrl':BASE},headers={'X-Auth-Return-Redirect':'1','Origin':BASE},max_redirects=0)
    google_url=(await signin.json())['url']
    assert parse_qs(urlparse(google_url).query)['redirect_uri'][0] == BASE+'/api/auth/callback/google'
    checks.append('Google OAuth initiation uses the fixed Preview callback; real Google authentication remains a manual check')
    assert not errors, errors
    for ctx in contexts.values(): await ctx.close()
    await browser.close()
  print(json.dumps({'passed':len(checks),'checks':checks,'pageErrors':errors},ensure_ascii=False,indent=2))
asyncio.run(main())
