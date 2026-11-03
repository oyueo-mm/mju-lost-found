import asyncio,json
from pathlib import Path
from http.cookiejar import MozillaCookieJar
from playwright.async_api import async_playwright,expect
async def main():
 data=json.loads(Path('.vercel/institution-fixtures.json').read_text(encoding='utf-8'))
 jar=MozillaCookieJar('.vercel/institution-protection.cookies');jar.load(ignore_discard=True,ignore_expires=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch()
  ctx=await browser.new_context(base_url='https://mju-lost-found-preview.vercel.app',locale='ko-KR')
  await ctx.add_cookies([{'name':c.name,'value':c.value,'domain':c.domain,'path':c.path,'secure':c.secure} for c in jar]+[{'name':'locale','value':'ko','domain':'mju-lost-found-preview.vercel.app','path':'/'},{'name':'__Secure-authjs.session-token','value':data['users']['owner']['cookie'],'domain':'mju-lost-found-preview.vercel.app','path':'/','secure':True}])
  page=await ctx.new_page()
  for kind in ['lost','found']:
   await page.goto('/'+kind+'/new',wait_until='load')
   await page.wait_for_timeout(1000)
   category=page.locator('select[name=categoryCode]')
   await expect(category).to_have_value('etc')
   await category.select_option('phone')
   await page.locator('input[name=title]').fill('Preview category choice verification')
   await expect(category).to_have_value('phone')
   await page.screenshot(path=f'.vercel/institution-{kind}-create.png',full_page=True)
  print('Both create forms default to etc and retain a manually selected category.',flush=True)
  endpoint=f"/api/posts/{data['posts'][2]}?type=found"
  assert (await ctx.request.patch(endpoint,data={'categoryCode':'phone','subcategory':None,'custody':{'state':'PLANNED','place':'Preview reported location'}})).status==200
  item=(await (await ctx.request.get(endpoint)).json())['data']
  assert item['custody']['state']=='PLANNED' and item['custody']['confirmedAt'] is None
  await page.goto(f"/post/{data['posts'][2]}/edit?type=found",wait_until='load')
  await expect(page.locator('select[name=categoryCode]')).to_have_value('phone')
  print('Editing retains the stored category; an owner-reported planned location remains unconfirmed.',flush=True)
  assert (await ctx.request.patch(endpoint,data={'status':'완료'})).status==200
  item=(await (await ctx.request.get(endpoint)).json())['data']
  assert item['status']=='완료'
  print('The ordinary owner can still complete their own post through the original API.',flush=True)
  await ctx.add_cookies([{'name':'__Secure-authjs.session-token','value':data['users']['service']['cookie'],'domain':'mju-lost-found-preview.vercel.app','path':'/','secure':True}])
  correction_endpoint=f"/api/posts/{data['posts'][1]}?type=found"
  async def correction(action,**fields):
   item=(await (await ctx.request.get(correction_endpoint)).json())['data']
   return await ctx.request.patch(correction_endpoint,data={'management':{'action':action,'expectedUpdatedAt':item['updatedAt'],'confirmed':True,**fields}})
  assert (await correction('correct_institution',organizationId=data['organizations'][0]['id'],place='Preview correction location',reason='Preview correction verification')).status==200
  assert (await correction('release',reason='Preview mistaken receipt verification')).status==200
  corrected=(await (await ctx.request.get(correction_endpoint)).json())['data']
  assert corrected['custodyOrganizationId'] is None and corrected['custody']['state']=='UNKNOWN' and corrected['custody']['confirmedAt'] is None
  print('Service-only reasoned agency correction and mistaken-receipt release are verified through HTTP.',flush=True)
  await page.set_viewport_size({'width':390,'height':900})
  await page.goto('/',wait_until='load')
  assert '물건을 설명하거나 사진을 올리면 비슷한 습득물을 보여줘요.' in ' '.join((await page.locator('body').inner_text()).split())
  await page.screenshot(path='.vercel/institution-home-final-390.png',full_page=True)
  assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  print('The final Preview home shows the revised Korean search hint without mobile overflow.',flush=True)
  await browser.close()
asyncio.run(main())
