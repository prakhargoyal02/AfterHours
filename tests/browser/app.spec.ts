import { test, expect } from '@playwright/test';
test('discover, navigation and honest unconfigured account state',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/discover?**',route=>route.fulfill({json:{items:[{track:{id:'audius:test',provider:'audius',provider_id:'test',title:'Evening current',artist:'Test artist',artist_id:'artist',duration:180,genre:'Ambient',artwork:null,playback:'audio',playback_url:'https://example.com/test',permalink:'https://audius.co'},reasons:['A gentler fit for unwind']}],weather:null}}));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Stay a little longer.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Play Evening current',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'work/'+info.project.name+'-discover.png',fullPage:true});
  await page.getByRole('button',{name:'Your music',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Welcome to AfterHours.'})).toBeVisible();
  await expect(page.getByText('Accounts will be available after')).toBeVisible();
  await page.getByRole('button',{name:'Create an account',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your music. Your people.'})).toBeVisible();
  await page.screenshot({path:'work/'+info.project.name+'-accounts.png',fullPage:true});
  expect(errors).toEqual([]);
});
test('provider errors have a recoverable state',async({page})=>{
  await page.route('**/api/discover?**',r=>r.fulfill({status:503,json:{detail:'The music provider is unavailable.'}}));
  await page.goto('/');await expect(page.getByRole('alert')).toContainText('The music provider is unavailable.');
  await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
});
