import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { database } from './supabase';
import type { Track } from './types';
import Sheet from './Sheet';
type Playlist={id:string;title:string;visibility:string};
export default function Library({userId,current,onPlay,onMessage}:{userId:string;current:Track|null;onPlay:(t:Track)=>void;onMessage:(s:string)=>void}) {
  const [tab,setTab]=useState('likes'),[rows,setRows]=useState<any[]>([]),[lists,setLists]=useState<Playlist[]>([]);
  const [selected,setSelected]=useState(''),[title,setTitle]=useState(''),[code,setCode]=useState(''),[pass,setPass]=useState('');
  const [loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [chosen,setChosen]=useState<string[]>([]);
  const [sharedProfile,setSharedProfile]=useState<{id:string;username:string;display_name:string;bio:string}|null>(null);
  const [editor,setEditor]=useState<{kind:'rename'|'delete'|'note';id:string;value:string}|null>(null);
  const update=()=>setRefresh(x=>x+1);
  async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);try{await action();update();return true;}catch(e){onMessage((e as Error).message);return false;}finally{setBusy(false);}}
  useEffect(()=>{let cancelled=false;setLoading(true);setError('');setRows([]);setChosen([]);
    (async()=>{
      try {
        const db=database();const list=await db.from('playlists').select('*').eq('user_id',userId).order('created_at',{ascending:false});if(list.error)throw list.error;
        if(!cancelled)setLists(list.data);
        const query=tab==='playlists'?selected?db.from('playlist_items').select('*').eq('playlist_id',selected).order('position'):null:
          db.from(tab==='history'?'listening_history':tab==='sessions'?'session_summaries':tab==='mixes'?'memory_mixes':'likes').select('*').eq('user_id',userId).limit(100);
        const result=query?await query:{data:[],error:null};if(result.error)throw result.error;
        if(!cancelled)setRows(result.data||[]);
      }catch(e){if(!cancelled)setError((e as Error).message);}finally{if(!cancelled)setLoading(false);}
    })();return()=>{cancelled=true;};
  },[tab,selected,userId,refresh]);
  async function create(){await run(async()=>{const r=await database().from('playlists').insert({user_id:userId,title}).select().single();if(r.error)throw r.error;setSelected(r.data.id);setTitle('');});}
  async function addCurrent(){if(!current||!selected)return;await run(async()=>{const r=await database().from('playlist_items').insert({playlist_id:selected,track_id:current.id,track:current,position:rows.length});if(r.error)throw r.error;});}
  async function remove(row:any){await run(async()=>{const table=tab==='history'?'listening_history':tab==='playlists'?'playlist_items':'likes';
    let q=database().from(table).delete();q=table==='likes'?q.eq('user_id',userId).eq('track_id',row.track_id):q.eq('id',row.id);
    const r=await q;if(r.error)throw r.error;});}
  async function share(){await run(async()=>{const tracks=rows.filter(r=>r.track&&(!chosen.length||chosen.includes(r.track_id))).map(r=>r.track);if(!tracks.length)throw new Error('Add some songs first.');
    const r=await database().from('music_passes').insert({user_id:userId,tracks,remaining_uses:1}).select('code').single();if(r.error)throw r.error;setPass(r.data.code);});}
  async function redeem(){await run(async()=>{const r=await database().rpc('redeem_music_pass',{pass_code:code.trim()});if(r.error)throw r.error;
    if(r.data.profile){setSharedProfile(r.data.profile);onMessage('Profile pass opened.');}
    else {setTab('playlists');setSelected(r.data.playlist_id);onMessage('Music Pass imported.');}
    setCode('');});}
  async function saveEdit(){
    if(!editor)return;
    const saved=await run(async()=>{
      const db=database();
      const result=editor.kind==='delete'?await db.from('playlists').delete().eq('id',editor.id):
        editor.kind==='rename'?await db.from('playlists').update({title:editor.value.trim()}).eq('id',editor.id):
        await db.from('listening_history').update({context:editor.value}).eq('id',editor.id);
      if(result.error)throw result.error;
      if(editor.kind==='delete')setSelected('');
    });
    if(saved)setEditor(null);
  }
  return <section><h2>Keep what moves you.</h2><div className="tabs">{['likes','playlists','history','sessions','mixes'].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>{setTab(t);setPass('');}}>{t==='mixes'?'Memory Mix':t[0].toUpperCase()+t.slice(1)}</button>)}</div>
    {tab==='playlists'&&<><div className="inline"><label>Playlist<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a playlist</option>{lists.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      <button disabled={!selected||!current} onClick={addCurrent}>Add current song</button></div>
      <form className="inline" onSubmit={e=>{e.preventDefault();create();}}><label>New playlist<input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label><button>Create playlist</button></form>
      {selected&&<div className="inline"><button disabled={busy} onClick={()=>setEditor({kind:'rename',id:selected,value:lists.find(p=>p.id===selected)?.title||''})}>Rename</button>
        <label>Playlist privacy<select disabled={busy||loading} value={lists.find(p=>p.id===selected)?.visibility||'private'} onChange={event=>{const visibility=event.target.value;void run(async()=>{const r=await database().from('playlists').update({visibility}).eq('id',selected);if(r.error)throw r.error;});}}><option value="private">Private</option><option value="public">Public · discoverable</option></select></label>
        <button disabled={busy} onClick={()=>setEditor({kind:'delete',id:selected,value:lists.find(p=>p.id===selected)?.title||'this playlist'})}>Delete playlist</button></div>}</>}
    {error?<div role="alert"><p>{error}</p><button onClick={update}>Retry library</button></div>:loading?<p role="status">Loading your music…</p>:rows.length===0?<p className="empty">Nothing saved here yet. Your next favourite is waiting.</p>:rows.map(row=>(tab==='sessions'||tab==='mixes')?<article className="session-memory" key={row.id}><h3>{tab==='mixes'?row.title:row.mode+' · '+new Date(row.started_at).toLocaleDateString()}</h3>{row.participants&&<p>{row.participants.join(', ')}</p>}{row.tracks.map((t:Track)=><button key={t.id} onClick={()=>onPlay(t)}>{t.title}</button>)}
      {tab==='sessions'&&<button onClick={()=>run(async()=>{const r=await database().from('memory_mixes').insert({user_id:userId,title:row.mode+' memories',tracks:row.tracks,session_ids:[row.id]});if(r.error)throw r.error;onMessage('Memory Mix saved.');})}>Save Memory Mix</button>}{tab==='mixes'&&<button onClick={()=>run(async()=>{const r=await database().from('memory_mixes').delete().eq('id',row.id);if(r.error)throw r.error;})}>Delete mix</button>}</article>:
      <div className="track-row" key={row.id||row.track_id}><button className="track-main" onClick={()=>onPlay(row.track)}><span>{row.track.title}<small>{row.track.artist}</small></span></button>
      {(tab==='likes'||tab==='playlists')&&<label className="check"><input type="checkbox" aria-label={'Include '+row.track.title+' in Music Pass'} checked={chosen.includes(row.track_id)} onChange={event=>setChosen(values=>event.target.checked?[...values,row.track_id]:values.filter(id=>id!==row.track_id))}/></label>}
      {tab==='history'&&<button onClick={()=>setEditor({kind:'note',id:row.id,value:row.context||''})}>Edit note</button>}
      <button onClick={()=>remove(row)}>Remove</button></div>)}
    {(tab==='likes'||tab==='playlists')&&rows.length>0&&<button disabled={busy||loading} onClick={share}>Create one-use Music Pass · {chosen.length||rows.length} songs</button>}
    {pass&&<div className="music-pass"><QRCodeSVG value={pass} size={160}/><p>One use · expires in 24 hours</p><code>{pass}</code><button onClick={()=>navigator.clipboard.writeText(pass).then(()=>onMessage('Code copied.')).catch(()=>onMessage('Copy the code shown above.'))}>Copy code</button></div>}
    <form className="inline pass-form" onSubmit={e=>{e.preventDefault();redeem();}}><label>Have a Music Pass?<input required value={code} onChange={e=>setCode(e.target.value)} placeholder="Paste a code"/></label><button>Import music</button></form>
    {sharedProfile&&<Sheet title={sharedProfile.display_name} onClose={()=>setSharedProfile(null)}><p>@{sharedProfile.username}</p><p>{sharedProfile.bio}</p>
      {sharedProfile.id!==userId&&<button disabled={busy} onClick={()=>void run(async()=>{const result=await database().from('follows').upsert({user_id:userId,target_id:sharedProfile.id});if(result.error)throw result.error;onMessage('Following '+sharedProfile.display_name+'.');})}>Follow listener</button>}
    </Sheet>}
    {editor&&<Sheet title={editor.kind==='note'?'Your listening note':editor.kind==='rename'?'Rename playlist':'Delete playlist'} onClose={()=>{if(!busy)setEditor(null);}}>
      <form onSubmit={event=>{event.preventDefault();void saveEdit();}}>
        {editor.kind==='delete'?<p>Delete “{editor.value}”? Its songs stay available in the music catalog.</p>:<label>{editor.kind==='note'?'A memory of this song':'Playlist name'}<input autoFocus required={editor.kind==='rename'} maxLength={editor.kind==='rename'?120:300} value={editor.value} onChange={event=>setEditor({...editor,value:event.target.value})}/></label>}
        <button disabled={busy||(editor.kind==='rename'&&!editor.value.trim())}>{busy?'Saving…':editor.kind==='delete'?'Delete playlist':'Save changes'}</button>
      </form>
    </Sheet>}
  </section>;
}
