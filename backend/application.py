import asyncio
import contextlib
import json
import os
import time
from uuid import UUID
from datetime import datetime, timezone
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, Depends, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from redis.exceptions import RedisError
from . import auth
from .providers import PROVIDERS, resolve, search_catalog
from .live import LiveStore, new_room, public_state, apply, GRACE
from .discovery import rank

live=LiveStore(os.getenv('REDIS_URL','redis://localhost:6379/0'))
@asynccontextmanager
async def lifespan(app):
    yield
    await live.redis.aclose()
app=FastAPI(title='AfterHours',lifespan=lifespan)

@app.exception_handler(RedisError)
async def redis_error(request,error):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=503,content={'detail':'Shared listening is unavailable. Start the dedicated Redis service.'})

@app.get('/api/health')
async def health():
    try: await asyncio.wait_for(live.redis.ping(),3); ready=True
    except (RedisError,asyncio.TimeoutError): ready=False
    return {'status':'ok','redis':ready,'accounts_configured':bool(os.getenv('SUPABASE_URL'))}

@app.get('/api/search')
async def search(q: str=Query(default='',max_length=200),provider: str='audius'):
    if provider not in PROVIDERS: raise HTTPException(422,'Unsupported provider.')
    try: return [t.model_dump() for t in await search_catalog(q,provider)]
    except (httpx.HTTPError,ValueError,KeyError): raise HTTPException(503,'The music provider is unavailable. Try again or select another provider.')

@app.get('/api/auth/config')
async def auth_config():
    try:
        url,key=auth.settings()
        async with httpx.AsyncClient(timeout=8) as client:
            response=await client.get(url+'/auth/v1/settings',headers={'apikey':key})
            response.raise_for_status()
            config=response.json()
        return {'google':bool(config.get('external',{}).get('google')),
                'signup':not config.get('disable_signup',True),
                'verification':not config.get('mailer_autoconfirm',True)}
    except (HTTPException,httpx.HTTPError,ValueError):
        return {'google':False,'signup':False,'verification':True}

@app.get('/api/tracks/{track_id}')
async def get_track(track_id:str):
    try: return (await resolve(track_id)).model_dump()
    except (ValueError,KeyError): raise HTTPException(404,'Track unavailable.')
    except httpx.HTTPError: raise HTTPException(503,'The music provider is unavailable.')

@app.get('/api/discover')
async def discover(mood:str=Query(default='Unwind',max_length=40),city:str=Query(default='',max_length=100),
                   region:str=Query(default='',max_length=80),language:str=Query(default='',max_length=80),
                   local_hour:int|None=Query(default=None,ge=0,le=23),
                   season:str=Query(default='',pattern='^(|spring|summer|autumn|winter)$'),
                   authorization:str=Header(default='')):
    temperature=None;weather=None;feedback=[];genres=[];liked_genres=[]
    if authorization:
        identity=await auth.user(authorization)
        feedback=await auth.rest('recommendation_feedback?user_id=eq.'+identity['id'],authorization[7:])
        prefs=await auth.rest('preferences?user_id=eq.'+identity['id'],authorization[7:])
        if prefs:
            genres=prefs[0]['genres']
            region=region or prefs[0].get('region','')
            language=language or next(iter(prefs[0].get('languages',[])),'')
        likes=await auth.rest('likes?user_id=eq.'+identity['id']+'&select=track&limit=100',authorization[7:])
        liked_genres=list({x.get('track',{}).get('genre','') for x in likes})
    if city:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                found=await client.get('https://geocoding-api.open-meteo.com/v1/search',params={'name':city,'count':1})
                found.raise_for_status();locations=found.json().get('results',[])
                if locations:
                    place=locations[0]
                    response=await client.get('https://api.open-meteo.com/v1/forecast',params={
                        'latitude':place['latitude'],'longitude':place['longitude'],
                        'current':'temperature_2m,weather_code,is_day','timezone':'auto'})
                    response.raise_for_status();weather=response.json()['current'];temperature=weather['temperature_2m']
                    weather['city']=place['name']
        except (httpx.HTTPError,KeyError,ValueError): weather=None
    # Region/language seed a catalog search, not an invented claim about track origin.
    context_query=' '.join(x.strip() for x in (region,language) if x.strip())
    try: tracks=await search_catalog(context_query)
    except (httpx.HTTPError,KeyError,ValueError): raise HTTPException(503,'Discovery is unavailable. Try search again shortly.')
    return {'items':rank(tracks,feedback,mood,genres,temperature,local_hour,
                        weather.get('weather_code') if weather else None,season,liked_genres),'weather':weather,
        'context':{'region':region,'language':language,'local_hour':local_hour,'season':season,'catalog_query':context_query},
        'refreshed_at':datetime.now(timezone.utc).isoformat(),'context_note':'City weather is used for this request only.'}

class RoomInput(BaseModel):
    mode: str='Distance'

async def profile(identity, token):
    rows=await auth.rest('profiles?id=eq.'+identity['id']+'&select=display_name',token)
    if not rows: raise HTTPException(409,'Complete your profile first.')
    return rows[0]['display_name']

@app.post('/api/rooms')
async def create_room(data:RoomInput,identity=Depends(auth.user),authorization: str=Header()):
    try:
        await live.rate_limit('create:'+identity['id'],5,60)
        room=new_room(identity['id'],await profile(identity,authorization[7:]),data.mode)
        await live.create(room)
        return public_state(room)
    except ValueError as e: raise HTTPException(422,str(e))

@app.post('/api/rooms/{code}/join')
async def join_room(code:str,identity=Depends(auth.user),authorization: str=Header()):
    try:
        await live.rate_limit('join:'+identity['id'],10,60)
        name=await profile(identity,authorization[7:])
        # RLS returns caller's own blocks; query both directions through a dedicated RPC.
        room=await live.get(code)
        blocked=await auth.rest('rpc/room_members_allowed',authorization[7:],'POST',{'member_ids':list(room['members'])})
        if not blocked: raise HTTPException(403,'You cannot join this room.')
        def join(room):
            if room['closed']: raise ValueError('This session has ended.')
            if len(room['members'])>=20 and identity['id'] not in room['members']: raise ValueError('This room is full.')
            room['members'][identity['id']]=name
            room['revision']+=1
        return public_state(await live.mutate(code,join))
    except ValueError as e: raise HTTPException(404,str(e))

@app.websocket('/ws/rooms/{code}')
async def socket(ws:WebSocket,code:str):
    if ws.headers.get('origin','') not in os.getenv('ALLOWED_ORIGINS','http://localhost:5173,http://127.0.0.1:5173').split(','):
        await ws.close(code=1008); return
    await ws.accept()
    subscription=None; forwarding=None; identity=None; connection=os.urandom(12).hex()
    key=live.key(code)
    try:
        credentials=await asyncio.wait_for(ws.receive_json(),10)
        token=str(credentials.get('token',''))
        identity=await auth.authenticate(token)
        room=await live.get(code)
        if identity['id'] not in room['members'] or room['closed']: raise ValueError('Join the room before connecting.')
        subscription=live.redis.pubsub()
        await subscription.subscribe(key+':events')
        await live.redis.zadd(key+':presence',{connection:time.time()+45})
        await live.redis.expire(key+':presence',6*3600)
        await ws.send_json({'type':'state','room':public_state(room),'server_time':time.time()})
        await ws.send_json({'type':'chat_history','messages':room['messages']})
        async def forward():
            async for event in subscription.listen():
                if event['type']=='message':
                    latest=await live.get(code)
                    if not await auth.rest('rpc/room_members_allowed',token,'POST',{'member_ids':list(latest['members'])}):
                        await ws.close(code=1008);return
                    await ws.send_text(event['data'])
        forwarding=asyncio.create_task(forward())
        validated=time.time()
        while True:
            raw=await asyncio.wait_for(ws.receive_text(),35)
            if len(raw)>4096: await ws.close(code=1009); break
            await live.redis.zadd(key+':presence',{connection:time.time()+45})
            if time.time()-validated>60: await auth.authenticate(token); validated=time.time()
            try:
                event=json.loads(raw)
                if not isinstance(event,dict): raise ValueError('Invalid message.')
                # Never accept client-supplied stream URLs or invented track metadata.
                event.pop('resolved_track',None)
                event.pop('resolved_playlist',None)
                await live.rate_limit('socket:'+identity['id'])
                if event.get('type')=='ping':
                    await ws.send_json({'type':'pong','client_time':event.get('client_time'),'server_time':time.time()}); continue
                room=await live.get(code)
                if not await auth.rest('rpc/room_members_allowed',token,'POST',{'member_ids':list(room['members'])}):
                    raise ValueError('A block prevents further interaction in this room.')
                if event.get('track'):
                    event['resolved_track']=(await resolve(str(event['track']))).model_dump()
                if event.get('playlist'):
                    playlist_id=str(UUID(str(event['playlist'])))
                    lists=await auth.rest('playlists?id=eq.'+playlist_id+'&select=id,title',token)
                    if not lists: raise ValueError('Playlist unavailable.')
                    items=await auth.rest('playlist_items?playlist_id=eq.'+playlist_id+'&select=track&order=position&limit=20',token)
                    event['resolved_playlist']={'title':lists[0]['title'],'tracks':[x['track'] for x in items]}
                updated=await live.mutate(code,lambda room:apply(room,identity['id'],event))
                if event.get('type')=='chat':
                    await live.redis.publish(key+':events',json.dumps({'type':'chat','message':updated['messages'][-1]}))
                if event.get('type')=='react':
                    await live.redis.publish(key+':events',json.dumps({'type':'chat_history','messages':updated['messages']}))
                if updated['closed']:
                    await live.redis.expire(key,GRACE)
                    await live.redis.publish(key+':events',json.dumps({'type':'ended'}))
                    break
            except (ValueError,TypeError,KeyError,httpx.HTTPError) as e:
                await ws.send_json({'type':'error','message':str(e) if not isinstance(e,httpx.HTTPError) else 'Track unavailable.'})
    except (WebSocketDisconnect,asyncio.TimeoutError,HTTPException,ValueError,RedisError):
        with contextlib.suppress(Exception): await ws.close(code=1008)
    finally:
        if forwarding:
            forwarding.cancel()
            with contextlib.suppress(asyncio.CancelledError): await forwarding
        if subscription: await subscription.aclose()
        if identity:
            with contextlib.suppress(RedisError):
                await live.redis.zrem(key+':presence',connection)
                await live.redis.zremrangebyscore(key+':presence','-inf',time.time())
                if await live.redis.zcard(key+':presence')==0:
                    # No renewal on rejoin: abandoned sessions expire irreversibly after grace.
                    ttl=await live.redis.ttl(key)
                    if ttl>GRACE: await live.redis.expire(key,GRACE)

@app.post('/api/rooms/{code}/memory')
async def save_session(code:str,identity=Depends(auth.user),authorization:str=Header()):
    try: room=await live.get(code)
    except ValueError as e: raise HTTPException(404,str(e))
    if identity['id'] not in room['members']: raise HTTPException(403,'Room membership required.')
    tracks={t['id']:t for t in room['played']}
    existing=await auth.rest('session_summaries?user_id=eq.'+identity['id']+'&room_code=eq.'+room['code'],authorization[7:])
    if existing: return existing
    return await auth.rest('session_summaries',authorization[7:],'POST',{
        'user_id':identity['id'],'room_code':room['code'],'mode':room['mode'],
        'tracks':list(tracks.values()),'participants':list(room['members'].values()),
        'started_at':datetime.fromtimestamp(room['created_at'],timezone.utc).isoformat()})

@app.delete('/api/account')
async def delete_account(identity=Depends(auth.user),authorization:str=Header()):
    # This key belongs ONLY to the dedicated AfterHours project. Never sent to the browser.
    secret=os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    if not secret: raise HTTPException(503,'Account deletion is not configured on this server.')
    url,_=auth.settings()
    headers={'apikey':secret,'Authorization':'Bearer '+secret}
    async with httpx.AsyncClient(timeout=20) as client:
        # Delete media before Auth deletion; fail closed and permit a retry.
        for bucket in ('avatars','story-photos'):
            while True:
                listing=await client.post(url+'/storage/v1/object/list/'+bucket,headers=headers,
                    json={'prefix':identity['id']+'/','limit':100,'offset':0})
                if listing.is_error: raise HTTPException(502,'Could not remove your media. Please retry.')
                objects=[identity['id']+'/'+x['name'] for x in listing.json()]
                if not objects: break
                deleted=await client.request('DELETE',url+'/storage/v1/object/'+bucket,headers=headers,json={'prefixes':objects})
                if deleted.is_error: raise HTTPException(502,'Could not remove your media. Please retry.')
        revoked=await client.post(url+'/auth/v1/logout?scope=global',headers={'apikey':secret,'Authorization':authorization})
        if revoked.is_error: raise HTTPException(502,'Could not revoke sessions. Please sign in and retry.')
        deleted=await client.delete(url+'/auth/v1/admin/users/'+identity['id'],headers=headers)
        if deleted.is_error: raise HTTPException(502,'Could not delete your account. Please retry.')
    return {'deleted':True}
