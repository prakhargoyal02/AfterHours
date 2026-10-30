import pytest
from fakeredis.aioredis import FakeRedis
from fastapi.testclient import TestClient
from . import application, auth, pings
from .providers import Track

ALICE = '11111111-1111-4111-8111-111111111111'
BOB = '22222222-2222-4222-8222-222222222222'
CAROL = '33333333-3333-4333-8333-333333333333'

@pytest.fixture
def setup(monkeypatch):
    redis = FakeRedis(decode_responses=True)
    state = {'friends':True, 'now':10000.0}
    monkeypatch.setattr(application.live, 'redis', redis)
    async def authenticate(token):
        return {'id':token, 'email_confirmed_at':'2026-01-01'}
    async def rest(path, token, **kwargs):
        assert path.startswith('friendships?')
        return [{'sender_id':ALICE, 'recipient_id':BOB}] if state['friends'] and token in (ALICE, BOB) else []
    async def resolve(identifier):
        return Track(id=identifier,provider='audius',provider_id='one',title='A song',
                     artist='Artist',artist_id='artist',duration=60,playback_url='https://example.test/audio')
    monkeypatch.setattr(auth, 'authenticate', authenticate)
    monkeypatch.setattr(auth, 'rest', rest)
    monkeypatch.setattr(pings, 'resolve', resolve)
    # Patch only this module's clock, not the process-wide clock used by Redis.
    class Clock:
        @staticmethod
        def time():
            return state['now']
    monkeypatch.setattr(pings, 'time', Clock)
    with TestClient(application.app) as client:
        yield client, redis, state

def headers(identity):
    return {'Authorization':'Bearer '+identity}

def send(client, sender=ALICE):
    return client.post('/api/pings',headers=headers(sender),
                       json={'recipient_id':BOB,'kind':'miss_you','track_id':'audius:one'})

def test_friend_only_ping_cooldown_and_private_dismissal(setup):
    client, redis, state = setup
    assert send(client,CAROL).status_code == 403
    assert send(client).status_code == 200
    assert send(client).status_code == 429
    items = client.get('/api/pings',headers=headers(BOB)).json()
    assert len(items) == 1 and items[0]['track']['id'] == 'audius:one'
    assert client.get('/api/pings',headers=headers(CAROL)).json() == []
    client.delete('/api/pings/'+items[0]['id'],headers=headers(CAROL))
    assert len(client.get('/api/pings',headers=headers(BOB)).json()) == 1
    client.delete('/api/pings/'+items[0]['id'],headers=headers(BOB))
    assert client.get('/api/pings',headers=headers(BOB)).json() == []
    assert 0 < client.portal.call(redis.ttl, 'afterhours:pings:'+BOB) <= pings.PING_TTL or client.portal.call(redis.ttl, 'afterhours:pings:'+BOB) == -2

def test_block_or_removed_friend_hides_existing_ping(setup):
    client, _, state = setup
    assert send(client).status_code == 200
    state['friends'] = False
    assert client.get('/api/pings',headers=headers(BOB)).json() == []
    assert send(client).status_code == 403

def test_expired_ping_is_not_returned_and_kind_is_bounded(setup):
    client, _, state = setup
    assert send(client).status_code == 200
    state['now'] += pings.PING_TTL + 1
    assert client.get('/api/pings',headers=headers(BOB)).json() == []
    response = client.post('/api/pings',headers=headers(ALICE),
        json={'recipient_id':BOB,'kind':'arbitrary_message','track_id':'audius:one'})
    assert response.status_code == 422
