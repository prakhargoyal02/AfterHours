import { useEffect, useRef, useState } from 'react';
import { database } from './supabase';
import Sheet from './Sheet';
import type { Track } from './types';
import MusicPings, { pingLabels } from './MusicPings';
import { api } from './api';

type Person = { id:string; username:string; display_name:string; bio:string };
type Friendship = { id:string; sender_id:string; recipient_id:string; status:'pending'|'accepted' };
type Playlist = { id:string; title:string };
const profileFields='id,username,display_name,bio';

export default function People({userId,current,onPlay,onMessage,onChanged}:{current:Track|null;onChanged:()=>void;userId:string;onPlay:(track:Track)=>void;onMessage:(message:string)=>void}) {
  const [view,setView]=useState('Discover'),[query,setQuery]=useState('');
  const [people,setPeople]=useState<Person[]>([]),[connections,setConnections]=useState<Friendship[]>([]);
  const [following,setFollowing]=useState<string[]>([]),[followers,setFollowers]=useState<string[]>([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<Person|null>(null),[playlists,setPlaylists]=useState<Playlist[]>([]);
  const [songs,setSongs]=useState<Track[]>([]),[playlistTitle,setPlaylistTitle]=useState('');
  const [sheetLoading,setSheetLoading]=useState(false),[sheetError,setSheetError]=useState('');
  const [report,setReport]=useState<Person|null>(null),[reason,setReason]=useState('');
  const request=useRef(0),sheetRequest=useRef(0);

  async function refresh() {
    const id=++request.current;setLoading(true);setError('');
    try {
      const db=database();
      const [friends,outgoing,incoming]=await Promise.all([
        db.from('friendships').select('*'),
        db.from('follows').select('target_id').eq('user_id',userId),
        db.from('follows').select('user_id').eq('target_id',userId)
      ]);
      for(const result of [friends,outgoing,incoming])if(result.error)throw result.error;
      const links:Friendship[]=friends.data||[];
      const out=(outgoing.data||[]).map(row=>row.target_id),into=(incoming.data||[]).map(row=>row.user_id);
      let candidates=db.from('profiles').select(profileFields).neq('id',userId);
      const ids=view==='Following'?out:view==='Followers'?into:view==='Friends'?
        links.filter(link=>link.status==='accepted').map(link=>link.sender_id===userId?link.recipient_id:link.sender_id):
        view==='Requests'?links.filter(link=>link.status==='pending').map(link=>link.sender_id===userId?link.recipient_id:link.sender_id):null;
      if(ids)candidates=candidates.in('id',ids.length?ids:['00000000-0000-0000-0000-000000000000']);
      else candidates=candidates.eq('visibility','public');
      const term=query.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
      if(term)candidates=candidates.ilike('username',term.replaceAll('_','\\_')+'%');
      const result=await candidates.order('username').limit(50);
      if(result.error)throw result.error;
      if(id!==request.current)return;
      setPeople(result.data||[]);setConnections(links);setFollowing(out);setFollowers(into);
    } catch(e){if(id===request.current)setError((e as Error).message);}
    finally{if(id===request.current)setLoading(false);}
  }
  useEffect(()=>{void refresh();return()=>{request.current++;};},[userId,view]);
  useEffect(()=>()=>{sheetRequest.current++;},[]);
  async function mutate(action:()=>PromiseLike<{error:{message:string}|null}>,message:string){
    setBusy(true);
    try{const result=await action();if(result.error)throw new Error(result.error.message);onMessage(message);onChanged();await refresh();return true;}
    catch(e){onMessage((e as Error).message);return false;}finally{setBusy(false);}
  }
  async function openProfile(person:Person){
    const id=++sheetRequest.current;
    setSelected(person);setSongs([]);setPlaylistTitle('');setPlaylists([]);setSheetError('');setSheetLoading(true);
    const result=await database().from('playlists').select('id,title').eq('user_id',person.id).eq('visibility','public').order('created_at',{ascending:false}).limit(30);
    if(id!==sheetRequest.current)return;
    setSheetLoading(false);
    if(result.error)setSheetError(result.error.message);else setPlaylists(result.data||[]);
  }
  async function openPlaylist(list:Playlist){
    const id=++sheetRequest.current;setSheetLoading(true);setSheetError('');setPlaylistTitle(list.title);setSongs([]);
    const result=await database().from('playlist_items').select('track').eq('playlist_id',list.id).order('position');
    if(id!==sheetRequest.current)return;
    setSheetLoading(false);
    if(result.error)setSheetError(result.error.message);else setSongs((result.data||[]).map(row=>row.track as Track));
  }
  async function sendPing(kind:keyof typeof pingLabels){
    if(!selected||!current)return;
    setBusy(true);
    try{await api('/pings',{recipient_id:selected.id,kind,track_id:current.id});onMessage('Your song is on its way. This ping expires in one hour.');}
    catch(e){onMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="people-experience" aria-label="Music community">
    <div className="people-heading"><h2>Good music.<br/>Better company.</h2><p>Find a familiar frequency. Follow a listener, discover their playlists, or invite them into your circle.</p></div>
    <MusicPings userId={userId} onPlay={onPlay}/>
    <div className="people-filters" aria-label="People filters">{['Discover','Friends','Requests','Following','Followers'].map(name=><button key={name} aria-pressed={view===name} onClick={()=>setView(name)}>{name}{name==='Followers'&&followers.length>0?' · '+followers.length:''}</button>)}</div>
    {view==='Requests'&&<p>Inviting someone shares your profile details with them. A friendship begins only when they accept.</p>}
    <form className="inline" onSubmit={event=>{event.preventDefault();void refresh();}}><label>Search listeners<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Username" maxLength={48}/></label><button disabled={loading}>Search</button></form>
    {error?<div role="alert"><p>{error}</p><button onClick={()=>void refresh()}>Retry people</button></div>:loading?<p role="status">Finding your people…</p>:<>
      {!people.length&&<p className="empty">{view==='Requests'?'No friend requests waiting.':view==='Friends'?'Your circle starts with one invitation. Find a listener in Discover.':'No visible listeners here yet. Try another username or explore Discover.'}</p>}
      <div className="people-list">{people.map(person=>{
        const connection=connections.find(link=>link.sender_id===person.id||link.recipient_id===person.id);
        const follows=following.includes(person.id);
        return <article className="listener-row" key={person.id}>
          <button className="listener-identity" onClick={()=>void openProfile(person)}><span className="listener-initial" aria-hidden="true">{person.display_name.slice(0,1)}</span><span><strong>{person.display_name}</strong><small>@{person.username}</small></span></button>
          <div className="listener-actions">
            <button disabled={busy} onClick={()=>void mutate(()=>follows?database().from('follows').delete().eq('user_id',userId).eq('target_id',person.id):database().from('follows').insert({user_id:userId,target_id:person.id}),follows?'Unfollowed.':'Following '+person.display_name+'.')}>{follows?'Unfollow':'Follow'}</button>
            {!connection?<button disabled={busy} onClick={()=>void mutate(()=>database().from('friendships').insert({sender_id:userId,recipient_id:person.id}),'Friend request sent.')}>Add friend</button>:
              connection.status==='accepted'?<button disabled={busy} onClick={()=>void mutate(()=>database().from('friendships').delete().eq('id',connection.id),'Removed from friends.')}>Remove friend</button>:
              <>{connection.recipient_id===userId&&<button className="primary" disabled={busy} onClick={()=>void mutate(()=>database().from('friendships').update({status:'accepted'}).eq('id',connection.id),'You are now friends.')}>Accept</button>}
              <button disabled={busy} onClick={()=>void mutate(()=>database().from('friendships').delete().eq('id',connection.id),'Request removed.')}>{connection.sender_id===userId?'Cancel request':'Decline'}</button></>}
          </div>
        </article>;
      })}</div>
    </>}
    {selected&&<Sheet title={selected.display_name} onClose={()=>{sheetRequest.current++;setSelected(null);}}>
      <p>@{selected.username}</p><p>{selected.bio||'Let the music do the talking.'}</p>
      {connections.some(link=>link.status==='accepted'&&(link.sender_id===selected.id||link.recipient_id===selected.id))&&<section className="ping-composer">
        <h3>Send a little of your soundtrack.</h3><p>{current?'With '+current.title+' · '+current.artist:'Play a song first, then send it with a feeling.'}</p>
        <div className="inline">{Object.entries(pingLabels).map(([kind,label])=><button key={kind} disabled={busy||!current} onClick={()=>void sendPing(kind as keyof typeof pingLabels)}>{label}</button>)}</div>
      </section>}
      <h3>{playlistTitle||'Public playlists'}</h3>
      {sheetLoading?<p role="status">Opening their music…</p>:sheetError?<div role="alert"><p>{sheetError}</p><button onClick={()=>void openProfile(selected)}>Retry profile</button></div>:playlistTitle?
        <><button onClick={()=>{setPlaylistTitle('');setSongs([]);}}>Back to playlists</button>{songs.length?songs.map(track=><button className="shared-song" key={track.id} onClick={()=>onPlay(track)}><strong>{track.title}</strong><small>{track.artist}</small></button>):<p>This playlist has no songs yet.</p>}</>:
        playlists.length?playlists.map(list=><button className="shared-song" key={list.id} onClick={()=>void openPlaylist(list)}><strong>{list.title}</strong><small>Open playlist</small></button>):<p>No public playlists to share yet.</p>}
      <div className="inline"><button disabled={busy} onClick={()=>{const person=selected;setSelected(null);void mutate(()=>database().from('blocks').insert({user_id:userId,target_id:person.id}),'Blocked. Your connections have been removed.');}}>Block listener</button>
      <button onClick={()=>{setReport(selected);setReason('');setSelected(null);}}>Report listener</button></div>
    </Sheet>}
    {report&&<Sheet title={'Report '+report.display_name} onClose={()=>setReport(null)}><form onSubmit={event=>{event.preventDefault();void mutate(()=>database().from('reports').insert({user_id:userId,target_id:report.id,reason:reason.trim()}),'Report submitted.').then(saved=>{if(saved)setReport(null);});}}>
      <label>What happened?<textarea required minLength={1} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label><button disabled={busy||!reason.trim()}>Submit report</button>
    </form></Sheet>}
  </section>;
}
