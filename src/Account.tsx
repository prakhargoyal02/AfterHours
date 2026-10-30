import { useEffect, useRef, useState, type FormEvent } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import type { User } from '@supabase/supabase-js';
import { database, supabase } from './supabase';
import { api } from './api';
import ProfilePass from './ProfilePass';

export function AuthForm({ recovery, done }: { recovery: boolean; done: () => void }) {
  const [mode,setMode]=useState(recovery?'recover':'login');
  const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false);
  const [googleEnabled,setGoogleEnabled]=useState(false);
  useEffect(()=>{let active=true;if(supabase)api<{google:boolean}>('/auth/config').then(r=>{if(active)setGoogleEnabled(r.google);}).catch(()=>{});return()=>{active=false;};},[]);
  useEffect(()=>{if(recovery)setMode('recover');},[recovery]);
  async function submit(e:FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const auth=database().auth; const redirect=location.origin;
      const result=mode==='signup'?await auth.signUp({email,password,options:{emailRedirectTo:redirect}}):
        mode==='reset'?await auth.resetPasswordForEmail(email,{redirectTo:redirect+'/?recovery=1'}):
        mode==='recover'?await auth.updateUser({password}):await auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
      if(mode==='signup')setMessage('Check your email to verify your account, then sign in.');
      else if(mode==='reset')setMessage('If this email has an account, a reset link is on its way.');
      else {if(mode==='recover')history.replaceState(null,'',location.pathname);done();}
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  async function google() {
    setBusy(true);
    try { const {error}=await database().auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin}}); if(error)throw error; }
    catch(e){setMessage((e as Error).message);setBusy(false);}
  }
  return <section className="account-panel"><h2>{mode==='signup'?'Your music. Your people.':mode==='reset'?'Find your way back.':mode==='recover'?'Choose a new password.':'Welcome to AfterHours.'}</h2>
    <p>Music feels different together.</p>
    {!supabase&&<p role="status">Accounts will be available after the dedicated AfterHours service is connected. You can explore music now.</p>}
    {(mode==='login'||mode==='signup')&&<><button disabled={!supabase||!googleEnabled||busy} onClick={google} className="primary wide">Continue with Google</button>{supabase&&!googleEnabled&&<p>Google sign-in is not available yet. You can use email and password.</p>}</>}
    <form onSubmit={submit}>{mode!=='recover'&&<label>Email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>}
      {mode!=='reset'&&<label>Password<input type="password" minLength={8} autoComplete={mode==='login'?'current-password':'new-password'} required value={password} onChange={e=>setPassword(e.target.value)}/></label>}
      <button disabled={!supabase||busy} className="primary">{busy?'Please wait…':mode==='signup'?'Create account':mode==='reset'?'Send reset link':mode==='recover'?'Save password':'Sign in'}</button>
    </form><p role="status">{message}</p>
    {mode!=='recover'&&<div className="inline"><button onClick={()=>setMode(mode==='signup'?'login':'signup')}>{mode==='signup'?'Already have an account?':'Create an account'}</button><button onClick={()=>setMode('reset')}>Forgot password?</button></div>}
  </section>;
}

export function Profile({user,onMessage,onDeleted}:{user:User;onMessage:(s:string)=>void;onDeleted:()=>void}) {
  const [profile,setProfile]=useState({username:'',display_name:'',bio:'',visibility:'private',avatar_path:''});
  const [prefs,setPrefs]=useState({region:'',languages:[] as string[],genres:[] as string[],artists:[] as string[],moods:[] as string[],history_enabled:true,onboarding_completed:false});
  const [step,setStep]=useState(0);
  const panel=useRef<HTMLElement>(null);
  const form=useRef<HTMLFormElement>(null);
  const stepHeading=useRef<HTMLHeadingElement>(null);
  useGSAP(()=>{
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)
      gsap.from('.onboarding-fields',{opacity:0,y:12,duration:.4,ease:'power2.out'});
  },{scope:panel,dependencies:[step],revertOnUpdate:true});
  const [loaded,setLoaded]=useState(false);const [busy,setBusy]=useState(false);const [deleting,setDeleting]=useState(false);const [confirm,setConfirm]=useState('');
  const [loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0);
  const [avatar,setAvatar]=useState('');
  useEffect(()=>{let active=true;(async()=>{
    setLoadError('');setLoaded(false);setAvatar('');setStep(0);
    try {
      const db=database();
      const [p,r]=await Promise.all([db.from('profiles').select('*').eq('id',user.id).single(),db.from('preferences').select('*').eq('user_id',user.id).single()]);
      if(p.error)throw p.error;if(r.error)throw r.error;
      if(!active)return;
      setProfile(p.data);setPrefs(r.data);setLoaded(true);
      if(p.data.avatar_path){const {data}=await db.storage.from('avatars').createSignedUrl(p.data.avatar_path,3600);if(active&&data)setAvatar(data.signedUrl);}
    }catch(e){if(active)setLoadError((e as Error).message);}
  })();return()=>{active=false;};},[user.id,retry]);
  function moveStep(next:number){
    if(next>step&&!form.current?.reportValidity())return;
    setStep(next);
    requestAnimationFrame(()=>stepHeading.current?.focus());
  }
  async function save(e:FormEvent) {
    e.preventDefault();
    if(!prefs.onboarding_completed&&step<2){moveStep(step+1);return;}
    setBusy(true);
    try {
      const db=database();
      const clean=(values:string[])=>[...new Set(values.map(value=>value.trim()).filter(Boolean))];
      const {error}=await db.rpc('save_listener_profile',{
        p_username:profile.username,p_display_name:profile.display_name,p_bio:profile.bio,p_visibility:profile.visibility,
        p_region:prefs.region,p_languages:clean(prefs.languages),p_genres:clean(prefs.genres),
        p_artists:clean(prefs.artists),p_moods:clean(prefs.moods),p_history_enabled:prefs.history_enabled
      });
      if(error)throw error;
      setPrefs({...prefs,onboarding_completed:true});onMessage('Your profile is saved.');
    }catch(e){onMessage((e as Error).message);}finally{setBusy(false);}
  }
  async function upload(file?:File) {
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){onMessage('Choose a JPG, PNG or WebP image under 5 MB.');return;}
    setBusy(true);
    try {
      const db=database(),path=user.id+'/'+crypto.randomUUID();
      const result=await db.storage.from('avatars').upload(path,file);if(result.error)throw result.error;
      const updated=await db.from('profiles').update({avatar_path:path}).eq('id',user.id);if(updated.error)throw updated.error;
      if(profile.avatar_path)await db.storage.from('avatars').remove([profile.avatar_path]);
      setProfile({...profile,avatar_path:path});
      const signed=await db.storage.from('avatars').createSignedUrl(path,3600);if(signed.data)setAvatar(signed.data.signedUrl);
      onMessage('Profile photo saved.');
    }catch(e){onMessage((e as Error).message);}finally{setBusy(false);}
  }
  async function removeAccount(){
    setBusy(true);
    try{await api('/account',undefined,'DELETE');await database().auth.signOut({scope:'local'});onDeleted();onMessage('Your AfterHours account and data have been deleted.');}
    catch(e){onMessage((e as Error).message);}finally{setBusy(false);}
  }
  const onboarding=!prefs.onboarding_completed;
  return <section className="account-panel" ref={panel}><h2 ref={stepHeading} tabIndex={-1}>{loaded&&onboarding?['Make yourself at home.','Find your frequency.','Choose what you share.'][step]:'Your corner of AfterHours.'}</h2>
    {!loaded?loadError?<div role="alert"><p>{loadError}</p><button onClick={()=>setRetry(x=>x+1)}>Retry profile</button></div>:<p>Loading your profile…</p>:<><div className="inline">{avatar&&<img className="avatar" src={avatar} alt="Your profile"/>}<label>Profile photo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>upload(e.target.files?.[0])}/></label></div>
    {onboarding&&<div className="onboarding-progress" aria-label={'Setup step '+(step+1)+' of 3'}>{['Your identity','Your music','Your privacy'].map((label,index)=><span key={label} aria-current={step===index?'step':undefined}>{label}</span>)}</div>}
    <form ref={form} onSubmit={save}>
      {(!onboarding||step===0)&&<div className="onboarding-fields">
      <label>Username<input required pattern="[a-z0-9_]{3,48}" maxLength={48} value={profile.username} onChange={e=>setProfile({...profile,username:e.target.value})}/></label>
      <label>Display name<input required maxLength={80} value={profile.display_name} onChange={e=>setProfile({...profile,display_name:e.target.value})}/></label>
      <label>Bio<textarea maxLength={500} value={profile.bio} onChange={e=>setProfile({...profile,bio:e.target.value})}/></label>
      </div>}
      {(!onboarding||step===1)&&<div className="onboarding-fields">
      <label>Region<input value={prefs.region} onChange={e=>setPrefs({...prefs,region:e.target.value})}/></label>
      {(['languages','genres','artists','moods'] as const).map(key=><label key={key}>{key[0].toUpperCase()+key.slice(1)} (comma separated)<input value={prefs[key].join(',')} onChange={e=>setPrefs({...prefs,[key]:e.target.value.split(',')})}/></label>)}
      <p>You can leave these blank and change them anytime.</p></div>}
      {(!onboarding||step===2)&&<div className="onboarding-fields">
      <label>Profile visibility<select value={profile.visibility} onChange={e=>setProfile({...profile,visibility:e.target.value})}><option value="private">Private</option><option value="public">Public</option></select></label>
      <p>Public profiles can be discovered by other listeners. Friends and people you invite can see your profile details. Your listening history stays private.</p>
      <label className="check"><input type="checkbox" checked={prefs.history_enabled} onChange={e=>setPrefs({...prefs,history_enabled:e.target.checked})}/>Save listening history</label></div>}
      <div className="inline">{onboarding&&step>0&&<button type="button" disabled={busy} onClick={()=>moveStep(step-1)}>Back</button>}
      <button className="primary" disabled={busy}>{busy?'Saving…':onboarding?step<2?'Continue':'Start listening':'Save profile'}</button></div>
    </form>{!onboarding&&<ProfilePass userId={user.id} isPublic={profile.visibility==='public'} onMessage={onMessage}/>}<button onClick={async()=>{await database().auth.signOut();onDeleted();}}>Sign out</button>
    <details><summary>Delete account</summary><p>This permanently deletes your AfterHours account, library and uploaded photos.</p>
      <label>Type DELETE to continue<input value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
      <button className="danger" disabled={confirm!=='DELETE'||busy} onClick={()=>setDeleting(true)}>Delete my account</button>
      {deleting&&<div role="alert"><p>This cannot be undone.</p><button disabled={busy} className="danger" onClick={removeAccount}>Permanently delete</button><button onClick={()=>setDeleting(false)}>Cancel</button></div>}
    </details></>}
  </section>;
}
