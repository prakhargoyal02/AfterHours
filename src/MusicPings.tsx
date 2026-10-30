import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { database } from './supabase';
import Sheet from './Sheet';
import type { Track } from './types';

export const pingLabels = {
  miss_you:'Miss You', thinking_of_you:'Thinking of You',
  listen_with_me:'Listen With Me', knock:'Knock'
};
type Ping = {id:string;sender_id:string;kind:keyof typeof pingLabels;track:Track;expires_at:number};

export default function MusicPings({userId,onPlay}:{userId:string;onPlay:(track:Track)=>void}) {
  const [open,setOpen]=useState(false),[items,setItems]=useState<Ping[]>([]);
  const [names,setNames]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const active=useRef(0);
  async function refresh(){
    const request=++active.current;setLoading(true);setError('');
    try{
      const pings=await api<Ping[]>('/pings');
      const ids=[...new Set(pings.map(ping=>ping.sender_id))];
      const result=ids.length?await database().from('profiles').select('id,display_name').in('id',ids):null;
      if(result?.error)throw result.error;
      if(request!==active.current)return;
      setItems(pings);setNames(Object.fromEntries((result?.data||[]).map(person=>[person.id,person.display_name])));
    }catch(e){if(request===active.current)setError((e as Error).message);}
    finally{if(request===active.current)setLoading(false);}
  }
  useEffect(()=>{
    if(!open)return;
    void refresh();
    const timer=setInterval(()=>void refresh(),30000);
    return()=>{clearInterval(timer);active.current++;};
  },[open,userId]);
  async function dismiss(id:string){
    try{await api('/pings/'+id,undefined,'DELETE');setItems(values=>values.filter(value=>value.id!==id));}
    catch(e){setError((e as Error).message);}
  }
  return <>
    <button onClick={()=>setOpen(true)}>Music pings</button>
    {open&&<Sheet title="A song says it better." onClose={()=>setOpen(false)}>
      <p>Notes from friends, carried by a song. Pings disappear after one hour. Nothing becomes a permanent conversation.</p>
      <button disabled={loading} onClick={()=>void refresh()}>Refresh pings</button>
      {error?<div role="alert"><p>{error}</p></div>:loading&&!items.length?<p role="status">Listening for a knock…</p>:!items.length?<p className="empty">No pings right now. Open a friend's profile to send a song.</p>:null}
      {!error&&items.filter(item=>item.expires_at>Date.now()/1000).map(item=><article className="music-ping" key={item.id}>
        <p><strong>{names[item.sender_id]||'A friend'}</strong> · {pingLabels[item.kind]}</p>
        <button className="shared-song" onClick={()=>onPlay(item.track)}><strong>{item.track.title}</strong><small>{item.track.artist}</small></button>
        <button onClick={()=>void dismiss(item.id)}>Dismiss ping</button>
      </article>)}
    </Sheet>}
  </>;
}
