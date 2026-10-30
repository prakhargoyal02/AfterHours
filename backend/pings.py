"""Short-lived music invitations. Redis only; no permanent message inbox."""
import json
import secrets
import time
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from . import auth
from .providers import resolve
import httpx

PING_TTL = 3600

class MusicPing(BaseModel):
    recipient_id: UUID
    kind: Literal['miss_you', 'thinking_of_you', 'listen_with_me', 'knock']
    track_id: str = Field(min_length=1, max_length=160)

async def friends(token, identity):
    rows = await auth.rest('friendships?status=eq.accepted&select=sender_id,recipient_id', token)
    return {row['recipient_id'] if row['sender_id'] == identity else row['sender_id'] for row in rows}

def ping_router(redis_client):
    router = APIRouter(prefix='/api/pings')

    @router.post('')
    async def send_ping(body: MusicPing, identity=Depends(auth.user), authorization: str=Header()):
        sender, recipient = identity['id'], str(body.recipient_id)
        token = authorization[7:]
        if recipient not in await friends(token, sender):
            raise HTTPException(403, 'Music pings are for accepted friends.')
        try:
            track = (await resolve(body.track_id)).model_dump()
        except (ValueError, KeyError):
            raise HTTPException(404, 'Choose an available song for your ping.')
        except httpx.HTTPError:
            raise HTTPException(503, 'The music provider is unavailable. Try again shortly.')
        redis = redis_client()
        # A sender-wide cooldown limits bursts across multiple friends.
        if not await redis.set('afterhours:ping-rate:'+sender, '1', ex=30, nx=True):
            raise HTTPException(429, 'Give your last ping a moment. Try again in 30 seconds.')
        if not await redis.set('afterhours:ping-pair:'+sender+':'+recipient, '1', ex=300, nx=True):
            raise HTTPException(429, 'Give this friend some space. Try again in five minutes.')
        now = time.time()
        item = {'id':secrets.token_hex(12), 'sender_id':sender, 'kind':body.kind,
                'track':track, 'created_at':now, 'expires_at':now+PING_TTL}
        key = 'afterhours:pings:'+recipient
        async with redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, '-inf', now-PING_TTL)
            pipe.zadd(key, {json.dumps(item):now})
            pipe.zremrangebyrank(key, 0, -21)
            pipe.expire(key, PING_TTL)
            await pipe.execute()
        return {'sent':True, 'expires_at':item['expires_at']}

    @router.get('')
    async def list_pings(identity=Depends(auth.user), authorization: str=Header()):
        allowed = await friends(authorization[7:], identity['id'])
        redis, now = redis_client(), time.time()
        key = 'afterhours:pings:'+identity['id']
        await redis.zremrangebyscore(key, '-inf', now-PING_TTL)
        values = await redis.zrevrange(key, 0, 19)
        items = []
        for value in values:
            item = json.loads(value)
            if item['sender_id'] not in allowed:
                await redis.zrem(key, value)
            else:
                items.append(item)
        return items

    @router.delete('/{ping_id}')
    async def dismiss_ping(ping_id: str, identity=Depends(auth.user)):
        redis = redis_client()
        key = 'afterhours:pings:'+identity['id']
        for value in await redis.zrange(key, 0, -1):
            if json.loads(value)['id'] == ping_id:
                await redis.zrem(key, value)
                break
        return {'dismissed':True}

    return router
