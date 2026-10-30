import { test, expect } from '@playwright/test';

test('people follow, request, cancel, playlists and report failure recovery',async({page},info)=>{
  const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'listener@example.test',app_metadata:{},user_metadata:{},created_at:'2026-10-30T00:00:00Z'};
  const person={id:'22222222-2222-4222-8222-222222222222',username:'evening_walk',display_name:'Evening Walk',bio:'Ambient tracks for the long way home.'};
  await page.addInitScript(user=>{
    const token=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'}))+'.test';
    localStorage.setItem('sb-afterhours-test-auth-token',JSON.stringify({access_token:token,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));
  },user);
  let following=false,requested=false,reports=0;
  await page.route('https://afterhours-test.supabase.co/**',async route=>{
    const url=new URL(route.request().url()),method=route.request().method();
    if(url.pathname.includes('/auth/'))return route.fulfill({json:user});
    if(url.pathname.endsWith('/preferences'))return route.fulfill({json:{onboarding_completed:true}});
    if(url.pathname.endsWith('/profiles'))return route.fulfill({json:[person]});
    if(url.pathname.endsWith('/friendships')){
      if(method==='POST')requested=true;
      if(method==='DELETE')requested=false;
      return route.fulfill({json:requested?[{id:'request-one',sender_id:user.id,recipient_id:person.id,status:'pending'}]:[]});
    }
    if(url.pathname.endsWith('/follows')){
      if(method==='POST')following=true;
      if(method==='DELETE')following=false;
      return route.fulfill({json:following&&url.searchParams.has('user_id')?[{target_id:person.id}]:[]});
    }
    if(url.pathname.endsWith('/playlists'))return route.fulfill({json:[{id:'playlist-one',title:'After the rain'}]});
    if(url.pathname.endsWith('/playlist_items'))return route.fulfill({json:[{track:{id:'audius:one',title:'Silver water',artist:'Test artist'}}]});
    if(url.pathname.endsWith('/reports')){reports++;return reports===1?route.fulfill({status:503,json:{message:'Please try again.'}}):route.fulfill({status:201,json:{}});}
    return route.fulfill({json:[]});
  });
  await page.route('**/api/discover?**',route=>route.fulfill({json:{items:[],weather:null}}));
  let pingVisible=true;
  await page.route('**/api/pings**',route=>{
    if(route.request().method()==='DELETE'){pingVisible=false;return route.fulfill({json:{dismissed:true}});}
    return route.fulfill({json:pingVisible?[{id:'ping-one',sender_id:person.id,kind:'thinking_of_you',track:{id:'audius:one',title:'Silver water',artist:'Test artist'},expires_at:Date.now()/1000+3600}]:[]});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'People',exact:true}).click();
  await expect(page.getByRole('button',{name:'Follow',exact:true})).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'Follow',exact:true}).click();
  await expect(page.getByRole('button',{name:'Unfollow',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add friend',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cancel request',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cancel request',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add friend',exact:true})).toBeVisible();
  await page.screenshot({path:'work/'+info.project.name+'-people.png',fullPage:true});
  await page.getByRole('button',{name:'Evening Walk @evening_walk'}).click();
  const sheet=page.getByRole('dialog',{name:'Evening Walk',exact:true});
  await sheet.getByRole('button',{name:'After the rain Open playlist'}).click();
  await expect(sheet.getByRole('button',{name:'Silver water Test artist'})).toBeVisible();
  await sheet.getByRole('button',{name:'Report listener'}).click();
  const report=page.getByRole('dialog',{name:'Report Evening Walk'});
  await report.getByLabel('What happened?').fill('Unwanted contact');
  await report.getByRole('button',{name:'Submit report'}).click();
  await expect(page.getByRole('status')).toContainText('Please try again.');
  await expect(report).toBeVisible();
  await expect(report.getByLabel('What happened?')).toHaveValue('Unwanted contact');
  await report.getByRole('button',{name:'Submit report'}).click();
  await expect(report).toHaveCount(0);
  expect(reports).toBe(2);
  await page.getByRole('button',{name:'Music pings',exact:true}).click();
  const pings=page.getByRole('dialog',{name:'A song says it better.'});
  await expect(pings.getByText('Thinking of You',{exact:false})).toBeVisible();
  await pings.getByRole('button',{name:'Dismiss ping'}).click();
  await expect(pings.getByText('No pings right now.',{exact:false})).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
