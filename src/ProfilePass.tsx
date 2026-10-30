import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { database } from './supabase';
import Sheet from './Sheet';

export default function ProfilePass({userId,isPublic,onMessage}:{userId:string;isPublic:boolean;onMessage:(message:string)=>void}){
  const [code,setCode]=useState(''),[busy,setBusy]=useState(false);
  async function create(){
    setBusy(true);
    try{
      const result=await database().from('music_passes').insert({user_id:userId,kind:'profile',tracks:[],remaining_uses:1}).select('code').single();
      if(result.error)throw result.error;
      setCode(result.data.code);
    }catch(e){onMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="profile-pass">
    <h3>Let someone find your frequency.</h3>
    <p>{isPublic?'Share your public profile with a one-use Music Pass.':'Save your profile as public to share it with a Music Pass.'}</p>
    <button disabled={!isPublic||busy} onClick={()=>void create()}>{busy?'Creating…':'Create profile Music Pass'}</button>
    {code&&<Sheet title="Your profile Music Pass" onClose={()=>setCode('')}><div className="music-pass">
      <QRCodeSVG value={code} size={180}/><p>One use · expires in 24 hours</p><code>{code}</code>
      <p>Paste this code into Music Pass in Your music. Making your profile private stops this pass from opening it.</p>
      <button onClick={()=>navigator.clipboard.writeText(code).then(()=>onMessage('Profile pass copied.')).catch(()=>onMessage('Copy the code shown above.'))}>Copy profile pass</button>
    </div></Sheet>}
  </section>;
}
