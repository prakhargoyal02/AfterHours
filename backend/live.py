"""Redis is the source of truth; a short distributed lock serializes each room."""
import json
import math
import secrets
import time
from redis.asyncio import Redis

MODES = {'Couple','Friends','Party','Distance','Road Trip','Bike Ride','Hiking','Study/Focus','Workout'}
TTL = 6 * 3600
GRACE = 90

def new_room(owner, name, mode):
    if mode not in MODES: raise ValueError('Unknown listening mode.')
    return {'code':secrets.token_hex(8).upper(),'host':owner,'mode':mode,
        'members':{owner:name},'queue':[],'track':None,'playing':False,'position':0,
        'updated_at':time.time(),'created_at':time.time(),'revision':0,
        'policy':'host','last_turn':'','closed':False,'messages':[],'played':[]}

def public_state(room):
    return {key:value for key,value in room.items() if key not in ('messages','played')}

def apply(room, member, event):
    if member not in room['members'] or room['closed']: raise ValueError('This session is unavailable.')
    kind = event.get('type')
    if kind in ('playback','policy','next','end','enqueue_next') and member != room['host']:
        raise ValueError('Only the host controls playback and room settings.')
    if kind == 'policy':
        if event.get('policy') not in ('host','everyone','turns','vote'): raise ValueError('Unknown queue policy.')
        room['policy'] = event['policy']
    elif kind in ('enqueue','enqueue_next'):
        if room['policy']=='host' and member!=room['host']: raise ValueError('Only the host can add songs.')
        if len(room['queue'])>=50: raise ValueError('The queue is full.')
        item={'id':secrets.token_hex(6),'track':event['resolved_track'],'by':member,'votes':[]}
        if kind=='enqueue_next': room['queue'].insert(0,item)
        else: room['queue'].append(item)
    elif kind == 'remove':
        item=next((x for x in room['queue'] if x['id']==event.get('id')),None)
        if not item: raise ValueError('Queue item not found.')
        if member!=room['host'] and item['by']!=member: raise ValueError('Only remove your own queued songs.')
        room['queue'].remove(item)
    elif kind == 'vote':
        if room['policy']!='vote': raise ValueError('Voting is not enabled.')
        item=next((x for x in room['queue'] if x['id']==event.get('id')),None)
        if not item: raise ValueError('Queue item not found.')
        if member in item['votes']: item['votes'].remove(member)
        else: item['votes'].append(member)
    elif kind in ('playback','next'):
        if kind=='next':
            if not room['queue']: raise ValueError('The queue is empty.')
            if room['policy']=='vote': room['queue'].sort(key=lambda x:-len(x['votes']))
            if room['policy']=='turns':
                members=list(room['members'])
                start=(members.index(room['last_turn'])+1)%len(members) if room['last_turn'] in members else 0
                order=members[start:]+members[:start]
                contributor=next((who for who in order if any(x['by']==who for x in room['queue'])),room['queue'][0]['by'])
                index=next(i for i,x in enumerate(room['queue']) if x['by']==contributor)
                room['queue'].insert(0,room['queue'].pop(index))
            item=room['queue'].pop(0); room['last_turn']=item['by']
            track,position,playing=item['track'],0,True
        else:
            track=event.get('resolved_track',room['track'])
            if not track: raise ValueError('Choose a track first.')
            position=float(event.get('position',0)); playing=event.get('playing') is True
        if not math.isfinite(position) or not 0<=position<=track['duration']: raise ValueError('Invalid playback position.')
        if not room['track'] or room['track']['id']!=track['id']: room['played'].append(track)
        room.update(track=track,position=position,playing=playing,updated_at=time.time())
    elif kind == 'chat':
        text=str(event.get('text','')).strip()
        if not text or len(text)>500: raise ValueError('Messages must contain 1–500 characters.')
        room['messages'].append({'id':secrets.token_hex(8),'user_id':member,'name':room['members'][member],
            'text':text,'track':event.get('resolved_track'),'playlist':event.get('resolved_playlist'),
            'reactions':{},'created_at':time.time()})
        room['messages']=room['messages'][-100:]
    elif kind == 'react':
        emoji=event.get('emoji')
        if emoji not in ('❤️','🔥','✨','👋'): raise ValueError('Unknown reaction.')
        message=next((m for m in room['messages'] if m['id']==event.get('id')),None)
        if not message: raise ValueError('This message has expired.')
        reactions=message.setdefault('reactions',{})
        people=reactions.setdefault(emoji,[])
        if member in people: people.remove(member)
        else: people.append(member)
    elif kind=='end':
        room.update(closed=True,playing=False,messages=[])
    else: raise ValueError('Unknown room action.')
    room['revision']+=1

class LiveStore:
    def __init__(self, url):
        # Pub/sub listeners are intentionally long-lived; don't give them a read timeout.
        self.redis=Redis.from_url(url,decode_responses=True,socket_connect_timeout=3)
    def key(self, code): return 'afterhours:room:'+code.upper()
    async def get(self, code):
        raw=await self.redis.get(self.key(code))
        if not raw: raise ValueError('This room has expired.')
        return json.loads(raw)
    async def create(self, room):
        await self.redis.set(self.key(room['code']),json.dumps(room),ex=TTL,nx=True)
    async def mutate(self, code, mutation):
        key=self.key(code)
        async with self.redis.lock(key+':lock',timeout=5,blocking_timeout=3):
            room=await self.get(code)
            mutation(room)
            ttl=await self.redis.ttl(key)
            # Reads/chat never extend the hard session lifetime.
            await self.redis.set(key,json.dumps(room),ex=max(1,min(TTL,ttl)))
            await self.redis.publish(key+':events',json.dumps({'type':'state','room':public_state(room),'server_time':time.time()}))
            return room
    async def rate_limit(self, identity, limit=40, window=10):
        key='afterhours:rate:'+identity+':'+str(int(time.time())//window)
        async with self.redis.pipeline(transaction=True) as pipe:
            pipe.incr(key); pipe.expire(key,window+1)
            count,_=await pipe.execute()
        if count>limit: raise ValueError('Slow down for a moment.')
