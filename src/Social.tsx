import { useEffect, useState } from 'react';
import { database } from './supabase';
import type { Track } from './types';
export default function Social({userId,current,onPlay,onMessage}:{userId:string;current:Track|null;onPlay:(t:Track)=>void;onMessage:(s:string)=>void}){
  const [query,setQuery]=useState(''),[people,setPeople]=useState<any[]>([]),[stories,setStories]=useState<any[]>([]),[caption,setCaption]=useState(''),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[blocks,setBlocks]=useState<any[]>([]);
  async function run(fn:()=>Promise<void>){setBusy(true);try{await fn();}catch(e){onMessage((e as Error).message);}finally{setBusy(false);}}
  async function refresh(){
    const db=database();
    const [s,b]=await Promise.all([db.from('stories').select('*').gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(30),db.from('blocks').select('target_id').eq('user_id',userId)]);
    if(s.error)throw s.error;if(b.error)throw b.error;
    const hydrated=await Promise.all(s.data.map(async item=>{
      if(!item.photo_path)return item;
      const signed=await db.storage.from('story-photos').createSignedUrl(item.photo_path,300);
      return {...item,image:signed.data?.signedUrl};
    }));
    setStories(hydrated);setBlocks(b.data);
  }
  useEffect(()=>{run(refresh);},[userId]);
  async function search(){
    const clean=query.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
    if(clean.length<3)throw new Error('Enter at least three username characters.');
    const r=await database().from('profiles').select('id,username,display_name,bio').eq('visibility','public').ilike('username',clean+'%').neq('id',userId).limit(20);
    if(r.error)throw r.error;setPeople(r.data);if(!r.data.length)onMessage('No public profiles found.');
  }
  async function post(){
    if(!current)throw new Error('Choose a song first. Every story starts with music.');
    if(!file)throw new Error('Add a photo. Every story needs both a photo and a song.');
    const db=database();let path:string|null=null;
    if(file){
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Choose a JPG, PNG or WebP under 10 MB.');
      path=userId+'/'+crypto.randomUUID();
      const uploaded=await db.storage.from('story-photos').upload(path,file);if(uploaded.error)throw uploaded.error;
    }
    const result=await db.from('stories').insert({user_id:userId,track_id:current.id,track:current,photo_path:path,caption});
    if(result.error){if(path)await db.storage.from('story-photos').remove([path]);throw result.error;}
    setCaption('');setFile(null);onMessage('Story shared for 24 hours, following your profile privacy.');await refresh();
  }
  return <section><h2>Find your people.<br/>Through their music.</h2>
    <form className="inline" onSubmit={e=>{e.preventDefault();run(search);}}><label>Find a public music profile<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Username" minLength={3} required/></label><button disabled={busy}>Find people</button></form>
    {people.map(p=><article className="person" key={p.id}><h3>{p.display_name} <small>@{p.username}</small></h3><p>{p.bio}</p><div className="inline">
      <button disabled={busy} onClick={()=>run(async()=>{const r=await database().from('follows').upsert({user_id:userId,target_id:p.id});if(r.error)throw r.error;onMessage('Following '+p.display_name+'.');})}>Follow</button>
      <button disabled={busy} onClick={()=>run(async()=>{const r=await database().from('blocks').upsert({user_id:userId,target_id:p.id});if(r.error)throw r.error;setPeople(xs=>xs.filter(x=>x.id!==p.id));await refresh();onMessage('Blocked. Their profile and shared content are hidden.');})}>Block</button>
      <button disabled={busy} onClick={()=>run(async()=>{const reason=prompt('What would you like to report?');if(!reason?.trim())return;const r=await database().from('reports').insert({user_id:userId,target_id:p.id,reason});if(r.error)throw r.error;onMessage('Report submitted.');})}>Report</button></div></article>)}
    <section className="story-composer"><h3>A photo. A song. A moment.</h3><p>{current?'Attached: '+current.title+' · '+current.artist:'Choose a song before sharing a story.'}</p>
      <form onSubmit={e=>{e.preventDefault();run(post);}}><div className="inline"><label>Photo (required)<input required type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)}/></label><label>A few words<input maxLength={160} value={caption} onChange={e=>setCaption(e.target.value)}/></label></div><button className="primary" disabled={!current||!file||busy}>Share music story</button></form>
    </section>
    <div className="stories">{stories.map(s=><article className="story" key={s.id}>{s.image&&<img src={s.image} alt={s.caption||'Music story photo'}/>}<div><button onClick={()=>onPlay(s.track)}>{s.track.title}<small>{s.track.artist}</small></button><p>{s.caption}</p>
      {s.user_id===userId&&<button disabled={busy} onClick={()=>run(async()=>{if(s.photo_path){const media=await database().storage.from('story-photos').remove([s.photo_path]);if(media.error)throw media.error;}const r=await database().from('stories').delete().eq('id',s.id);if(r.error)throw r.error;await refresh();})}>Delete story</button>}</div></article>)}</div>
    {!stories.length&&<p className="empty">No music stories yet. Share the song in your moment.</p>}
    <details><summary>Blocked profiles ({blocks.length})</summary>{blocks.map(b=><div className="inline" key={b.target_id}><span>{b.target_id.slice(0,8)}…</span><button disabled={busy} onClick={()=>run(async()=>{const r=await database().from('blocks').delete().eq('user_id',userId).eq('target_id',b.target_id);if(r.error)throw r.error;await refresh();})}>Unblock</button></div>)}</details>
  </section>;
}
