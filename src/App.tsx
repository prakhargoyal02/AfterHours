import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { AudioLines, Compass, Heart, Library as LibraryIcon, Radio, Search, UserRound, Users, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Volume2, Ellipsis } from 'lucide-react';
import { api } from './api';
import { player } from './audio';
import type { Track } from './types';
import { database, supabase } from './supabase';
import Liquid from './Liquid';
import { AuthForm, Profile } from './Account';
import Library from './Library';
import SyncWave from './SyncWave';
import Social from './Social';
import NowPlaying from './NowPlaying';
import Sheet from './Sheet';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
gsap.registerPlugin(useGSAP);

const feedbackOptions=[['not_interested','Not interested'],['less_like_this','Less like this'],['never_artist','Don’t recommend this artist'],['never_song','Don’t recommend this song again'],['not_this_mood','Not for this mood']];
const time=(s:number)=>Number.isFinite(s)?Math.floor(s/60)+':'+Math.floor(s%60).toString().padStart(2,'0'):'0:00';
export default function App(){
  const shell = useRef<HTMLDivElement>(null);
  const [expanded,setExpanded]=useState(false),[queueOpen,setQueueOpen]=useState(false),[offline,setOffline]=useState(!navigator.onLine);
  const [roomActive,setRoomActive]=useState(false),[roomMode,setRoomMode]=useState('Distance');
  const [queue,setQueue]=useState<Track[]>([]);
  const roomEnqueue=useRef<((track:Track)=>void)|null>(null);
  useEffect(()=>{const update=()=>setOffline(!navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  const [user,setUser]=useState<User|null>(null),[tab,setTab]=useState('discover'),[recovery,setRecovery]=useState(new URLSearchParams(location.search).has('recovery'));
  const [tracks,setTracks]=useState<Track[]>([]),[current,setCurrent]=useState<Track|null>(null),[playing,setPlaying]=useState(false),[position,setPosition]=useState(0);
  const [query,setQuery]=useState(''),[provider,setProvider]=useState('audius'),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [mood,setMood]=useState('Unwind'),[city,setCity]=useState(''),[weather,setWeather]=useState<any>(null),[reason,setReason]=useState<Record<string,string>>({});
  const [shuffle,setShuffle]=useState(false),[repeat,setRepeat]=useState(false),[volume,setVolume]=useState(.65),[likes,setLikes]=useState<string[]>([]);
  const [region,setRegion]=useState(''),[language,setLanguage]=useState(''),[season,setSeason]=useState(''),[weatherOpen,setWeatherOpen]=useState(false);
  const lastSearch=useRef(false);
  const requestId=useRef(0),logged=useRef(''),currentRef=useRef<Track|null>(null),nextRef=useRef<()=>void>(()=>{});
  const loadRef=useRef<()=>void>(()=>{}),playRequest=useRef(0);
  const [loadingAuth,setLoadingAuth]=useState(!!supabase);
  useEffect(()=>{
    if(!supabase)return;
    supabase.auth.getSession().then(({data,error})=>{if(error)setNotice(error.message);setUser(data.session?.user||null);setLoadingAuth(false);});
    const {data}=supabase.auth.onAuthStateChange((event,session)=>{setUser(session?.user||null);if(event==='PASSWORD_RECOVERY'){setRecovery(true);setTab('account');}});
    return()=>data.subscription.unsubscribe();
  },[]);
  useEffect(()=>{if(recovery)setTab('account');},[recovery]);
  useEffect(()=>{
    let active=true;
    if(user&&supabase)supabase.from('preferences').select('onboarding_completed').eq('user_id',user.id).single().then(({data,error})=>{
      if(!active)return;
      if(error)setNotice('Your profile setup could not be checked. Open Profile to retry.');
      else if(!data.onboarding_completed)setTab('account');
    });
    return()=>{active=false;};
  },[user?.id]);
  useEffect(()=>{setLikes([]);if(user&&supabase)supabase.from('likes').select('track_id').eq('user_id',user.id).then(r=>{if(!r.error)setLikes(r.data.map(x=>x.track_id));});},[user?.id]);
  useEffect(()=>{currentRef.current=current;},[current]);
  useEffect(()=>{
    const audio=player.audio;
    const update=()=>setPosition(audio.currentTime),play=()=>setPlaying(true),pause=()=>setPlaying(false),ended=()=>nextRef.current();
    const failed=()=>setNotice('This source could not play the track. Try another song or provider.');
    audio.addEventListener('timeupdate',update);audio.addEventListener('play',play);audio.addEventListener('pause',pause);audio.addEventListener('ended',ended);audio.addEventListener('error',failed);
    return()=>{audio.removeEventListener('timeupdate',update);audio.removeEventListener('play',play);audio.removeEventListener('pause',pause);audio.removeEventListener('ended',ended);audio.removeEventListener('error',failed);};
  },[]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),9000);return()=>clearTimeout(timer);},[notice]);
  async function load(search=false){
    lastSearch.current=search;
    const id=++requestId.current;setLoading(true);setError('');
    try{
      if(search){
        const result=await api<Track[]>('/search?q='+encodeURIComponent(query)+'&provider='+provider);
        if(id===requestId.current){setTracks(result);setReason({});}
      }else{
        const result=await api<any>('/discover?mood='+encodeURIComponent(mood)+'&city='+encodeURIComponent(city)+'&region='+encodeURIComponent(region)+'&language='+encodeURIComponent(language)+'&season='+season+'&local_hour='+new Date().getHours());
        if(id===requestId.current){setTracks(result.items.map((x:any)=>x.track));setWeather(result.weather);setReason(Object.fromEntries(result.items.map((x:any)=>[x.track.id,x.reasons[0]])));}
      }
    }catch(e){if(id===requestId.current)setError((e as Error).message);}finally{if(id===requestId.current)setLoading(false);}
  }
  loadRef.current=()=>load();
  useEffect(()=>{load();const timer=setInterval(()=>loadRef.current(),5*60*1000);return()=>clearInterval(timer);},[mood,user?.id]);
  async function play(track:Track){
    if(roomActive){roomEnqueue.current?.(track);setNotice('Requested this song in the shared queue.');return;}
    const request=++playRequest.current;
    try{
      // Re-resolve expiring provider playback URLs rather than relying on saved audio URLs.
      const resolved=await api<Track>('/tracks/'+encodeURIComponent(track.id));
      if(request!==playRequest.current)return;
      await player.load(resolved);if(request!==playRequest.current)return;setCurrent(resolved);setNotice('');
      if(user&&logged.current!==track.id){
        logged.current=track.id;
        const db=database(),prefs=await db.from('preferences').select('history_enabled').eq('user_id',user.id).single();
        if(prefs.data?.history_enabled){const result=await db.from('listening_history').insert({user_id:user.id,track_id:track.id,track});if(result.error)setNotice('Playing, but history could not be saved.');}
      }
    }catch(e){setNotice((e as Error).message);}
  }
  function next(direction=1){
    const sequence=queue.length?queue:tracks;
    if(!sequence.length)return;
    const index=sequence.findIndex(t=>t.id===currentRef.current?.id);
    play(sequence[shuffle?Math.floor(Math.random()*sequence.length):(index+direction+sequence.length)%sequence.length]);
  }
  nextRef.current=()=>{if(roomActive)return;if(repeat&&currentRef.current)play(currentRef.current);else next();};
  function requireUser(){if(user)return true;setTab('account');setNotice('Sign in to keep your music and listen together.');return false;}
  async function like(track:Track){
    if(!requireUser())return;
    const db=database(),liked=likes.includes(track.id);
    const result=liked?await db.from('likes').delete().eq('user_id',user!.id).eq('track_id',track.id):await db.from('likes').insert({user_id:user!.id,track_id:track.id,track});
    if(result.error)setNotice(result.error.message);else setLikes(xs=>liked?xs.filter(x=>x!==track.id):[...xs,track.id]);
  }
  async function feedback(track:Track,kind:string){
    if(!requireUser()||!kind)return;
    const result=await database().from('recommendation_feedback').insert({user_id:user!.id,track_id:track.id,artist_id:track.artist_id,provider:track.provider,mood,kind});
    if(result.error)setNotice(result.error.message);else{setTracks(xs=>xs.filter(x=>kind==='never_artist'?x.artist_id!==track.artist_id:x.id!==track.id));setNotice('We’ll use this to shape your next recommendations.');}
  }
  async function follow(track:Track){
    if(!requireUser())return;
    const r=await database().from('followed_artists').upsert({user_id:user!.id,provider:track.provider,artist_id:track.artist_id,name:track.artist},{onConflict:'user_id,provider,artist_id'});
    setNotice(r.error?r.error.message:'Following '+track.artist+'.');
  }
  useGSAP(()=>{
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const target=shell.current?.querySelector('main');
    if(target)gsap.fromTo(target,{y:12,opacity:.65},{y:0,opacity:1,duration:.55,ease:'expo.out'});
  },{scope:shell,dependencies:[tab],revertOnUpdate:true});
  const atmosphere=roomActive?roomMode:mood;
  const rainy=!!weather && weather.weather_code>=51 && weather.weather_code<=82;
  const toggle=()=>playing?player.audio.pause():player.play().catch(e=>setNotice(e.message));
  const navigation=[['discover','Discover',Compass],['library','Your music',LibraryIcon],['sync','SyncWave',Radio],['social','People',Users],['account',user?'Profile':'Sign in',UserRound]] as const;
  return <div ref={shell} className={'app '+(playing?'is-playing':'')} data-atmosphere={atmosphere}>
    <aside className="sidebar"><a href="/" className="brand"><AudioLines/>AfterHours<span>®</span></a><nav aria-label="Main navigation">{navigation.map(([key,label,Icon])=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)} aria-current={tab===key?'page':undefined}><Icon size={20}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-note"><span className="signal-dot"/>Made for the hours<br/>that feel like yours.</div></aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-context"><span className="wordmark">AfterHours</span><span>Music feels different together.</span></div><button onClick={()=>roomActive?setTab('sync'):setQueueOpen(true)}>Queue</button><button className="profile-chip" onClick={()=>setTab('account')}><UserRound size={18}/>{user?'Your profile':'Join AfterHours'}</button></header>
      <main>
      {offline&&<div role="status" className="connection-banner">You’re offline. Reconnect to search and listen together.</div>}
      {tab==='discover'&&<>
        <section className="hero"><div className="hero-copy"><h1>Stay a little<br/><em>longer.</em></h1><p>A sound for this moment.<br/>Someone to share it with.</p><button className="primary" disabled={!tracks.length||loading} onClick={()=>play(tracks[0])}><Play size={17} fill="currentColor"/>Find my flow</button><div className="hero-meta"><span><i/>{error?'Atmosphere unavailable':loading?'Finding your atmosphere':'Made for this moment'}</span><span>{tracks.length?tracks.length+' tracks in this atmosphere':'Tuning the room'}</span></div></div>
          <div className="hero-art"><Liquid playing={playing} mood={atmosphere} rain={rainy}/><div className="art-caption"><AudioLines size={16}/><span>{playing?'Live contour · reacting to your audio':'Liquid signal · waiting for a track'}</span></div></div>
        </section>
        <section className="discovery"><div className="section-heading"><div><h2>Your kind of atmosphere.</h2></div><span>{weather?weather.city+' · '+Math.round(weather.temperature_2m)+'°C':'WeatherFlow'}</span></div>
          <div className="moods">{['Unwind','Focus','Dreamy','Energy'].map(m=><button key={m} aria-pressed={mood===m} onClick={()=>setMood(m)}>{m}</button>)}</div>
          <form className="search-form" onSubmit={e=>{e.preventDefault();load(true);}}><Search size={19}/><input aria-label="Search songs or artists" placeholder="Find a song, find a feeling…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Music provider" value={provider} onChange={e=>setProvider(e.target.value)}><option value="audius">Audius</option><option value="jamendo">Jamendo</option></select><button disabled={loading}>Search</button></form>
          <button className="weather-settings" onClick={()=>setWeatherOpen(true)}>Tune WeatherFlow</button>
          {weatherOpen&&<Sheet title="WeatherFlow" onClose={()=>setWeatherOpen(false)}>
            <p>Your moment shapes the music. Region and language guide catalog searches; they are not verified labels for every song.</p>
            <form onSubmit={e=>{e.preventDefault();load();setWeatherOpen(false);}} className="weather-form">
              <label>City<input value={city} onChange={e=>setCity(e.target.value)} placeholder="e.g. Bengaluru"/></label>
              <label>Region<input value={region} onChange={e=>setRegion(e.target.value)} placeholder="Use your profile preference"/></label>
              <label>Language<input value={language} onChange={e=>setLanguage(e.target.value)} placeholder="Use your profile preference"/></label>
              <label>Season<select value={season} onChange={e=>setSeason(e.target.value)}><option value="">No seasonal preference</option>{['spring','summer','autumn','winter'].map(x=><option key={x}>{x}</option>)}</select></label>
              <p>Refreshes every five minutes using your local hour and city-level weather. No location history is saved.</p>
              <button className="primary">Refresh atmosphere</button>
            </form>
          </Sheet>}

          {error?<div role="alert" className="empty"><p>{error}</p><button onClick={()=>load(lastSearch.current)}>Try again</button></div>:loading?<p className="empty" role="status">Finding your next sound…</p>:!tracks.length?<p className="empty">No songs found. Try another search.</p>:<div className="track-table"><div className="track-head" aria-hidden="true"><span>#</span><span>Track</span><span>Atmosphere</span><span>Time</span><span/></div><div className="track-list">{tracks.map((track,i)=><article className={'track-row '+(current?.id===track.id?'selected':'')} key={track.id}>
            <span className="track-number">{String(i+1).padStart(2,'0')}</span><button className="track-main" onClick={()=>play(track)} aria-label={'Play '+track.title}>{track.artwork?<img src={track.artwork} alt="" loading="lazy"/>:<span className="art-placeholder"><AudioLines/></span>}<span>{track.title}<small>{track.artist} · {track.genre||track.provider}</small></span></button>
            <span className="track-reason">{reason[track.id]||track.provider}</span><span className="duration">{time(track.duration)}</span>
            <button aria-label={(likes.includes(track.id)?'Unlike ':'Like ')+track.title} aria-pressed={likes.includes(track.id)} className="icon-button" onClick={()=>like(track)}><Heart size={18} fill={likes.includes(track.id)?'currentColor':'none'}/></button>
            <details className="track-menu"><summary aria-label={'More options for '+track.title}><Ellipsis size={19}/></summary><div><button onClick={()=>{if(roomActive){roomEnqueue.current?.(track);setNotice('Requested this song in the shared queue.');return;}setQueue(q=>q.some(t=>t.id===track.id)?q:[...q,track]);setNotice('Added to your queue.');}}>Add to queue</button><button onClick={()=>follow(track)}>Follow artist</button><a href={track.permalink} target="_blank" rel="noreferrer">Open on {track.provider}</a><select aria-label={'Recommendation feedback for '+track.title} value="" onChange={e=>feedback(track,e.target.value)}><option value="">Shape my recommendations</option>{feedbackOptions.map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></div></details>
          </article>)}</div></div>}
        </section>
        <section className="together"><div><h2>A little closer,<br/>even from far away.</h2><p>Start a SyncWave. Bring someone into your soundtrack.</p></div><button onClick={()=>setTab('sync')}>Listen together <Radio size={18}/></button></section>
      </>}
      {tab==='library'&&(user?<Library userId={user.id} current={current} onPlay={play} onMessage={setNotice}/>:<AuthForm recovery={false} done={()=>setTab('library')}/>)}
      {user&&<div hidden={tab!=='sync'}><SyncWave userId={user.id} current={current} onTrack={setCurrent} onMessage={setNotice} onQueueReady={fn=>{roomEnqueue.current=fn;}} onSession={(active,mode)=>{setRoomActive(active);setRoomMode(mode);}}/></div>}
      {tab==='sync'&&!user&&<AuthForm recovery={false} done={()=>setTab('sync')}/>}
      {tab==='social'&&(user?<Social userId={user.id} current={current} onPlay={play} onMessage={setNotice}/>:<AuthForm recovery={false} done={()=>setTab('social')}/>)}
      {tab==='account'&&(loadingAuth?<p>Restoring your session…</p>:user&&!recovery?<Profile user={user} onMessage={setNotice} onDeleted={()=>{setUser(null);setTab('discover');}}/>:<AuthForm recovery={recovery} done={()=>{setRecovery(false);setTab('account');}}/>)}
      </main>
      <footer className="site-footer"><span>AfterHours © 2026</span><span>Your music. Your space. Your people.</span></footer>
    </div>
    <section className="player-dock" aria-label="Now playing">
      <button className="playing-track" disabled={!current} aria-label="Open immersive player" onClick={()=>setExpanded(true)}>{current?.artwork?<img src={current.artwork} alt=""/>:<AudioLines size={28}/>}<div><strong>{current?.title||'Find your next feeling'}</strong><small>{current?.artist||'Choose a song to begin'}</small></div></button>
      <div className="transport"><div className="transport-buttons">
        <button className="icon-button secondary-control" aria-label="Shuffle" aria-pressed={shuffle} onClick={()=>setShuffle(!shuffle)}><Shuffle size={17}/></button>
        <button className="icon-button" aria-label="Previous song" disabled={!current||roomActive} onClick={()=>next(-1)}><SkipBack size={20}/></button>
        <button className="play-button" aria-label={playing?'Pause':'Play'} disabled={!current||roomActive} onClick={toggle}>{playing?<Pause size={20} fill="currentColor"/>:<Play size={20} fill="currentColor"/>}</button>
        <button className="icon-button" aria-label="Next song" disabled={!current||roomActive} onClick={()=>next()}><SkipForward size={20}/></button>
        <button className="icon-button secondary-control" aria-label="Repeat song" aria-pressed={repeat} onClick={()=>setRepeat(!repeat)}><Repeat size={17}/></button></div>
        <div className="timeline"><span>{time(position)}</span><input aria-label="Playback position" type="range" min={0} max={current?.duration||1} step={.1} value={Math.min(position,current?.duration||1)} disabled={!current||roomActive} onChange={e=>{player.audio.currentTime=Number(e.target.value);setPosition(Number(e.target.value));}}/><span>{time(current?.duration||0)}</span></div>
      </div>
      <label className="volume"><Volume2 size={18}/><input aria-label="Volume" type="range" min={0} max={1} step={.01} value={volume} onChange={e=>{setVolume(Number(e.target.value));player.audio.volume=Number(e.target.value);}}/></label>
    </section>
    {expanded&&current&&<NowPlaying track={current} playing={playing} position={position} mood={atmosphere} rain={rainy}
      shuffle={shuffle} repeat={repeat} liked={likes.includes(current.id)} locked={roomActive}
      onClose={()=>setExpanded(false)} onToggle={toggle} onSeek={n=>{player.audio.currentTime=n;setPosition(n);}}
      onNext={next} onShuffle={()=>setShuffle(!shuffle)} onRepeat={()=>setRepeat(!repeat)} onLike={()=>{if(!user)setExpanded(false);like(current);}}
      onQueue={()=>{setExpanded(false);if(roomActive)setTab('sync');else setQueueOpen(true);}}
      onTogether={()=>{setExpanded(false);setTab('sync');}}/>}
    {queueOpen&&<Sheet title="Your queue" onClose={()=>setQueueOpen(false)}>
      <p>Choose what plays next. Your queue stays here while you explore.</p>
      {!queue.length?<p className="empty">Add songs using their options menu in Discover.</p>:queue.map((t,i)=><div className="queue-item" key={t.id}><button onClick={()=>play(t)}>{t.title}<small>{t.artist}</small></button><button disabled={i===0} onClick={()=>setQueue(q=>{const next=[...q];[next[i-1],next[i]]=[next[i],next[i-1]];return next;})} aria-label={'Move up '+t.title}>Up</button><button onClick={()=>setQueue(q=>q.filter(x=>x.id!==t.id))} aria-label={'Remove '+t.title}>Remove</button></div>)}
    </Sheet>}
    {notice&&<div className="toast" role="status">{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice('')}>×</button></div>}
  </div>;
}
