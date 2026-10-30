import { test, expect } from '@playwright/test';

test('new listener setup preserves choices across steps and failed saves',async({page})=>{
  const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'listener@example.test',app_metadata:{},user_metadata:{},created_at:'2026-10-30T00:00:00Z'};
  await page.addInitScript(user=>{
    const token=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'}))+'.test';
    localStorage.setItem('sb-afterhours-test-auth-token',JSON.stringify({
      access_token:token,refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,
      expires_in:3600,token_type:'bearer',user
    }));
  },user);
  let saves=0;
  await page.route('https://afterhours-test.supabase.co/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.includes('/rpc/save_listener_profile')){
      saves++;
      const payload=route.request().postDataJSON();
      expect(payload.p_username).toBe('evening_listener');
      expect(payload.p_languages).toEqual(['Hindi','English']);
      expect(payload.p_visibility).toBe('private');
      expect(payload.p_history_enabled).toBe(false);
      return saves===1?route.fulfill({status:409,json:{message:'This username is already taken.'}}):route.fulfill({status:204});
    }
    if(url.pathname.includes('/auth/'))return route.fulfill({json:user});
    if(url.pathname.endsWith('/profiles'))return route.fulfill({json:{id:user.id,username:'listener_generated',display_name:'Listener',bio:'',visibility:'private',avatar_path:''}});
    if(url.pathname.endsWith('/preferences'))return route.fulfill({json:{user_id:user.id,region:'',languages:[],genres:[],artists:[],moods:[],history_enabled:true,onboarding_completed:false}});
    return route.fulfill({json:[]});
  });
  await page.route('**/api/discover?**',r=>r.fulfill({json:{items:[],weather:null}}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Make yourself at home.'})).toBeVisible({timeout:15000});
  await page.getByLabel('Username',{exact:true}).fill('evening_listener');
  await page.getByLabel('Display name',{exact:true}).fill('Evening listener');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Languages (comma separated)').fill(' Hindi, English, Hindi, ');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByLabel('Profile visibility')).toHaveValue('private');
  await page.getByLabel('Save listening history').uncheck();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.getByLabel('Languages (comma separated)')).toHaveValue(' Hindi, English, Hindi, ');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Start listening',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('This username is already taken.');
  await expect(page.getByRole('heading',{name:'Choose what you share.'})).toBeVisible();
  await page.getByRole('button',{name:'Start listening',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your corner of AfterHours.'})).toBeVisible();
  expect(saves).toBe(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
