"""WebSocket integration with a Redis-compatible test double, never a production fallback."""
import pytest
import fakeredis
from fakeredis.aioredis import FakeRedis
from fastapi.testclient import TestClient
from . import application, auth
from .providers import Track
from .live import GRACE

@pytest.fixture
def client(monkeypatch):
    server = fakeredis.FakeServer()
    redis = FakeRedis(server=server, decode_responses=True)
    monkeypatch.setattr(application.live, 'redis', redis)
    monkeypatch.setenv('ALLOWED_ORIGINS', 'http://testserver')
    async def authenticate(token):
        if token not in ('host', 'guest'):
            from fastapi import HTTPException
            raise HTTPException(401, 'Invalid test token')
        return {'id': token, 'email_confirmed_at': '2026-01-01'}
    async def rest(path, token, method='GET', data=None):
        if path.startswith('profiles?'):
            return [{'display_name': token.title()}]
        if path == 'rpc/room_members_allowed':
            return True
        raise AssertionError('Unexpected persistence call: ' + path)
    async def resolve(identifier):
        return Track(id=identifier,provider='audius',provider_id='test',title='Test',
                     artist='Artist',artist_id='artist',duration=60,playback_url='https://example.com/test.mp3')
    monkeypatch.setattr(auth, 'authenticate', authenticate)
    monkeypatch.setattr(auth, 'rest', rest)
    monkeypatch.setattr(application, 'resolve', resolve)
    with TestClient(application.app) as test_client:
        yield test_client

def receive(ws, kind, predicate=lambda event: True):
    for _ in range(20):
        event = ws.receive_json()
        if event['type'] == kind and predicate(event):
            return event
    raise AssertionError('Expected event not received: ' + kind)

def connect(ws, token):
    ws.send_json({'token':token})
    state=receive(ws,'state')
    receive(ws,'chat_history')
    return state

def test_two_clients_host_authority_chat_reactions_and_expiry(client):
    response=client.post('/api/rooms',json={'mode':'Couple'},headers={'Authorization':'Bearer host'})
    assert response.status_code==200
    code=response.json()['code']
    assert client.post('/api/rooms/'+code+'/join',json={},headers={'Authorization':'Bearer guest'}).status_code==200
    with client.websocket_connect('/ws/rooms/'+code,headers={'origin':'http://testserver'}) as host:
        connect(host,'host')
        with client.websocket_connect('/ws/rooms/'+code,headers={'origin':'http://testserver'}) as guest:
            connect(guest,'guest')
            guest.send_json({'type':'playback','track':'audius:test','position':0,'playing':True})
            assert 'host' in receive(guest,'error')['message']
            host.send_json({'type':'playback','track':'audius:test','position':12,'playing':True})
            state=receive(guest,'state',lambda e:e['room']['playing'])
            assert state['room']['position']==12
            assert state['room']['updated_at']>0
            assert 'messages' not in state['room']
            guest.send_json({'type':'chat','text':'This moment','resolved_track':{'id':'forged'}})
            message=receive(host,'chat')['message']
            assert message['track'] is None
            host.send_json({'type':'react','id':message['id'],'emoji':'❤️'})
            messages=receive(guest,'chat_history',lambda e:bool(e['messages'][0]['reactions']))['messages']
            assert messages[0]['reactions']['❤️']==['host']
            host.send_json({'type':'end'})
            receive(guest,'ended')
            key=application.live.key(code)
            assert 0<client.portal.call(application.live.redis.ttl,key)<=GRACE
            saved=client.portal.call(application.live.get,code)
            assert saved['messages']==[]

def test_abandoned_room_gets_grace_and_bad_origin_is_rejected(client):
    code=client.post('/api/rooms',json={},headers={'Authorization':'Bearer host'}).json()['code']
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect('/ws/rooms/'+code,headers={'origin':'https://untrusted.example'}):
            pass
    with client.websocket_connect('/ws/rooms/'+code,headers={'origin':'http://testserver'}) as host:
        connect(host,'host')
    assert 0<client.portal.call(application.live.redis.ttl,application.live.key(code))<=GRACE
