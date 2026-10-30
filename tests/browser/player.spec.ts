import { test, expect } from '@playwright/test';

test('real audio transport, immersive sheet, queue and keyboard dismissal', async ({page}, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  // A generated 20-second PCM tone exercises HTMLAudio + Web Audio; no copyrighted fixture.
  const rate=8000, samples=rate*20, wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF',0); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(rate,24); wav.writeUInt32LE(rate*2,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
  wav.write('data',36); wav.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/rate)*700),44+i*2);
  const track={id:'audius:test',provider:'audius',provider_id:'test',title:'Evening current',artist:'Test artist',
    artist_id:'test',genre:'Ambient',duration:20,artwork:null,playback:'audio',playback_url:'data:audio/wav;base64,'+wav.toString('base64'),permalink:'https://audius.co'};
  await page.route('**/api/discover?**',r=>r.fulfill({json:{items:[{track,reasons:['A gentler fit']}],weather:null}}));
  await page.route('**/api/tracks/**',r=>r.fulfill({json:track}));
  await page.goto('/');
  await page.getByRole('button',{name:'Play Evening current',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open immersive player'}).click();
  const dialog=page.getByRole('dialog',{name:'Now playing'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Pause',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  await dialog.getByRole('slider',{name:'Seek song'}).fill('8');
  await expect(dialog.getByText('0:08',{exact:true})).toBeVisible();
  await expect(dialog).toHaveJSProperty('open',true);
  await page.screenshot({path:'work/'+info.project.name+'-now-playing.png'});
  await dialog.getByRole('button',{name:'Queue',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Your queue'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('More options for Evening current').click();
  await page.getByRole('button',{name:'Add to queue',exact:true}).click();
  await page.getByRole('button',{name:'Open immersive player'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Queue',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove Evening current'})).toBeVisible();
  await page.getByRole('button',{name:'Remove Evening current'}).click();
  await expect(page.getByText('Add songs using their options menu in Discover.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('discovery retry remains discovery and offline status is truthful', async ({page,context})=>{
  let calls=0;
  await page.route('**/api/discover?**',r=>{calls++;return r.fulfill({status:503,json:{detail:'Provider unavailable'}});});
  await page.goto('/');
  await page.getByRole('button',{name:'Try again'}).click();
  await expect.poll(()=>calls).toBeGreaterThan(1);
  await context.setOffline(true);
  await expect(page.getByText('You’re offline. Reconnect to search and listen together.')).toBeVisible();
});
