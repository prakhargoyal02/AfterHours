import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { currentToken } from './supabase';
import { modes, type Track } from './types';
import { player } from './audio';
import Sheet from './Sheet';
import Liquid from './Liquid';
import { database } from './supabase';
type Room={code:string;host:string;mode:string;members:Record<string,string>;track:Track|null;queue:{id:string;track:Track;by:string;votes:string[]}[];policy:string;playing:boolean;position:number;updated_at:number;revision:number;closed:boolean};
export default function SyncWave({userId,current,onTrack,onMessage,onSession,onQueueReady}:{userId:string;current:Track|null;onTrack:(t:Track)=>void;onMessage:(s:string)=>void;onSession:(active:boolean,mode:string)=>void;onQueueReady:(fn:((track:Track)=>void)|null)=>void}) {
  const [chatOpen,setChatOpen]=useState(false),[queueOpen,setQueueOpen]=useState(false),[reconnect,setReconnect]=useState(0);
  const [mode,setMode]=useState('Distance'),[code,setCode]=useState(''),[room,setRoom]=useState<Room|null>(null),[messages,setMessages]=useState<any[]>([]),[text,setText]=useState(''),[connected,setConnected]=useState(false),[busy,setBusy]=useState(false);
  const ws=useRef<WebSocket|null>(null),offset=useRef(0),lastRevision=useRef(-1),roomRef=useRef<Room|null>(null);
  const [playlists,setPlaylists]=useState<{id:string;title:string}[]>([]),[playlist,setPlaylist]=useState('');
  useEffect(()=>{if(!chatOpen)return;database().from('playlists').select('id,title').eq('user_id',userId).then(r=>{if(r.error)onMessage(r.error.message);else setPlaylists(r.data);});},[chatOpen,userId]);
  const playbackVersion=useRef('');
  useEffect(()=>{onQueueReady(track=>send({type:'enqueue',track:track.id}));return()=>{onQueueReady(null);onSession(false,'Distance');player.audio.pause();};},[]);
  useEffect(()=>{onSession(!!room&&!room.closed,room?.mode||mode);},[room?.code,room?.closed,room?.mode]);
  useEffect(()=>{const ended=()=>{const r=roomRef.current;if(r?.host===userId&&!r.closed&&r.queue.length)send({type:'next'});};player.audio.addEventListener('ended',ended);return()=>player.audio.removeEventListener('ended',ended);},[userId]);
  const send=(data:unknown)=>{if(ws.current?.readyState===WebSocket.OPEN)ws.current.send(JSON.stringify(data));else onMessage('Reconnect to the room before sending.');};
  useEffect(()=>{roomRef.current=room;},[room]);
  useEffect(()=>{
    if(!room?.code)return;
    let active=true;let timer:ReturnType<typeof setInterval>;let socket:WebSocket;
    (async()=>{const token=await currentToken();if(!active)return;
      socket=new WebSocket(location.origin.replace(/^http/,'ws')+'/ws/rooms/'+room.code);ws.current=socket;
      socket.onopen=()=>{socket.send(JSON.stringify({token}));socket.send(JSON.stringify({type:'ping',client_time:Date.now()/1000}));timer=setInterval(()=>socket.readyState===1&&socket.send(JSON.stringify({type:'ping',client_time:Date.now()/1000})),10000);};
      socket.onclose=()=>{setConnected(false);clearInterval(timer);};
      socket.onmessage=async(event)=>{
        const data=JSON.parse(event.data);
        if(data.type==='pong'){offset.current=data.server_time-(data.client_time+Date.now()/1000)/2;return;}
        if(data.type==='error'){onMessage(data.message);return;}
        if(data.type==='ended'){setMessages([]);player.audio.pause();onMessage('Session ended. Chat has disappeared.');return;}
        if(data.type==='chat_history'){setMessages(data.messages);return;}
        if(data.type==='chat'){setMessages(items=>[...items,data.message].slice(-100));return;}
        if(data.type==='state'&&data.room.revision>=lastRevision.current){
          setConnected(true);
          if(lastRevision.current<0)offset.current=data.server_time-Date.now()/1000;
          lastRevision.current=data.room.revision;setRoom(data.room);
          if(data.room.closed){setMessages([]);player.audio.pause();return;}
          if(!data.room.track)return;
          const version=[data.room.track.id,data.room.updated_at,data.room.playing].join(':');
          if(playbackVersion.current===version)return;
          playbackVersion.current=version;
          const r=data.room as Room;const target=Math.min(r.track!.duration,r.position+(r.playing?Math.max(0,Date.now()/1000+offset.current-r.updated_at):0));
          try{onTrack(r.track!);await player.load(r.track!,r.playing,target);}catch{onMessage('Tap “Enable room audio” to allow synchronized playback.');}
        }
      };
    })().catch(e=>onMessage(e.message));
    return()=>{active=false;clearInterval(timer);socket?.close();ws.current=null;player.audio.playbackRate=1;};
  },[room?.code,reconnect]);
  useEffect(()=>{const timer=setInterval(()=>{
    const r=roomRef.current;if(!r?.track||!r.playing||r.closed||player.audio.paused||ws.current?.readyState!==WebSocket.OPEN)return;
    const expected=Math.min(r.track.duration,r.position+Math.max(0,Date.now()/1000+offset.current-r.updated_at));
    const drift=expected-player.audio.currentTime;
    if(Math.abs(drift)>1.5){player.audio.currentTime=expected;player.audio.playbackRate=1;}
    else player.audio.playbackRate=Math.abs(drift)>.15?(drift>0?1.02:.98):1;
  },2000);return()=>clearInterval(timer);},[]);
  async function enter(join:boolean){setBusy(true);try{lastRevision.current=-1;playbackVersion.current='';setMessages([]);setRoom(await api<Room>(join?'/rooms/'+code.trim().toUpperCase()+'/join':'/rooms',join?{}:{mode}));}catch(e){onMessage((e as Error).message);}finally{setBusy(false);}}
  const host=room?.host===userId;
  async function saveQueue(){
    if(!room?.queue.length)return;
    try{
      const db=database();
      const list=await db.from('playlists').insert({user_id:userId,title:room.mode+' together'}).select('id').single();
      if(list.error)throw list.error;
      const unique=[...new Map(room.queue.map(q=>[q.track.id,q.track])).values()];
      const result=await db.from('playlist_items').insert(unique.map((track,position)=>({playlist_id:list.data.id,track_id:track.id,track,position})));
      if(result.error){await db.from('playlists').delete().eq('id',list.data.id);throw result.error;}
      onMessage('Shared queue saved to your playlists.');
    }catch(e){onMessage((e as Error).message);}
  }
  return <section className="sync-experience"><h2>Different places.<br/>Same moment.</h2><p>Everyone listens on their own device. One shared queue, perfectly yours.</p>
    {!room?<><form className="inline" onSubmit={e=>{e.preventDefault();enter(false);}}><label>How are you listening?<select value={mode} onChange={e=>setMode(e.target.value)}>{modes.map(m=><option key={m}>{m}</option>)}</select></label><button disabled={busy} className="primary">Start SyncWave</button></form>
      <form className="inline" onSubmit={e=>{e.preventDefault();enter(true);}}><label>Room code<input required maxLength={16} value={code} onChange={e=>setCode(e.target.value)}/></label><button disabled={busy}>Join a room</button></form></>:
      <><div className="room-header"><h3>{room.mode}</h3><span>{connected?'Connected':'Disconnected'} · {Object.keys(room.members).length} listeners</span></div>
      <div className="room-atmosphere"><Liquid playing={room.playing&&!room.closed} mood={room.mode}/><div><h3>{room.track?.title||'Make the first move.'}</h3><p>{room.track?.artist||'Add a song and bring everyone into the moment.'}</p></div></div>
      <p className="room-code">{room.code}</p><button onClick={()=>navigator.clipboard.writeText(room.code).then(()=>onMessage('Room code copied.')).catch(()=>onMessage('Copy the code above.'))}>Copy invitation</button>
      <p>{Object.values(room.members).join(' · ')}</p>
      {!connected&&!room.closed&&<button onClick={()=>{lastRevision.current=-1;playbackVersion.current='';setReconnect(x=>x+1);}}>Reconnect to room</button>}
      <div className="inline"><button disabled={!room.track||room.closed} onClick={()=>{if(room.track)player.load(room.track,room.playing,room.position).catch(e=>onMessage(e.message));}}>Enable room audio</button>
      <button disabled={!current||!connected||room.closed} onClick={()=>send({type:'enqueue',track:current?.id})}>Add current song</button>
      {host&&<><button disabled={!current||room.closed} onClick={()=>send({type:'playback',track:current?.id,position:0,playing:true})}>Play current for everyone</button>
      <button disabled={!room.track||room.closed} onClick={()=>send({type:'playback',position:player.audio.currentTime,playing:!room.playing})}>{room.playing?'Pause room':'Play room'}</button><button disabled={!room.queue.length||room.closed} onClick={()=>send({type:'next'})}>Next song</button>
      <label>Queue permissions<select value={room.policy} onChange={e=>send({type:'policy',policy:e.target.value})}>{['host','everyone','turns','vote'].map(p=><option key={p}>{p}</option>)}</select></label></>}</div>
      <button onClick={()=>setQueueOpen(true)}>Shared queue · {room.queue.length}</button>
      {queueOpen&&<Sheet title="Shared queue" onClose={()=>setQueueOpen(false)}>
        {!room.queue.length&&<p>No songs queued yet. Add the current song to start.</p>}
        {room.queue.map(q=><div className="queue-item" key={q.id}><span>{q.track.title}<small>{q.track.artist}</small></span>{(host||q.by===userId)&&<button disabled={!connected||room.closed} onClick={()=>send({type:'remove',id:q.id})}>Remove</button>}{room.policy==='vote'&&<button disabled={!connected||room.closed} onClick={()=>send({type:'vote',id:q.id})}>Vote · {q.votes.length}</button>}</div>)}
        <button disabled={!room.queue.length} onClick={saveQueue}>Save queue as playlist</button>
      </Sheet>}
      <div className="inline"><button onClick={()=>api('/rooms/'+room.code+'/memory',{}).then(()=>onMessage('Session saved without chat.')).catch(e=>onMessage(e.message))}>Save session</button>
      {host&&<button disabled={room.closed} onClick={()=>send({type:'end'})}>End session</button>}<button onClick={()=>{ws.current?.close();setRoom(null);setMessages([]);}}>Leave</button></div>
      {!room.closed&&<><button className="chat-bubble" onClick={()=>setChatOpen(true)}>Room conversation · {messages.length}</button>{chatOpen&&<Sheet title="Room conversation" onClose={()=>setChatOpen(false)}><p>Temporary. Disappears after the session.</p><div className="messages" role="log">{messages.map(m=><article className="chat-message" key={m.id}>
          <strong>{m.name}</strong><p>{m.text}</p>
          {[...(m.track?[m.track]:[]),...(m.playlist?.tracks||[])].map((t:Track)=><div className="chat-song" key={t.id}>
            <span>{t.title}<small>{t.artist}</small></span>
            <div className="inline">
              <button disabled={!connected} onClick={()=>send({type:'enqueue',track:t.id})}>Add to queue</button>
              {host?<><button disabled={!connected} onClick={()=>send({type:'playback',track:t.id,position:0,playing:true})}>Play</button><button disabled={!connected} onClick={()=>send({type:'enqueue_next',track:t.id})}>Play next</button></>:
                <button disabled={!connected} onClick={()=>send({type:'chat',text:'Can we play this next?',track:t.id})}>Request next</button>}
            </div>
          </div>)}
          {m.playlist&&<small>Playlist: {m.playlist.title} · shared selection</small>}
          <div className="reactions">{['❤️','🔥','✨','👋'].map(emoji=><button key={emoji} disabled={!connected} aria-label={'React '+emoji+' to '+m.name}
            aria-pressed={m.reactions?.[emoji]?.includes(userId)||false} onClick={()=>send({type:'react',id:m.id,emoji})}>{emoji} {m.reactions?.[emoji]?.length||''}</button>)}</div>
        </article>)}</div>
        <form className="inline" onSubmit={e=>{e.preventDefault();send({type:'chat',text});setText('');}}><label>Message<input required maxLength={500} value={text} onChange={e=>setText(e.target.value)}/></label><button disabled={!connected}>Send</button></form>
        <button disabled={!current||!connected} onClick={()=>send({type:'chat',text:'Listen to this',track:current?.id})}>Share current song</button>
        <div className="inline"><label>Share a playlist<select value={playlist} onChange={e=>setPlaylist(e.target.value)}><option value="">Choose your playlist</option>{playlists.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label><button disabled={!playlist||!connected} onClick={()=>send({type:'chat',text:'A playlist for this moment',playlist})}>Share up to 20 songs</button></div>
        </Sheet>}</>}</>}
  </section>;
}
