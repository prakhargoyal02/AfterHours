import copy
import math
import pytest
import asyncio
from fastapi.testclient import TestClient
from .application import app
from .live import new_room, apply, public_state
from .providers import Audius, Track
from .discovery import rank

def track():
    return {'id':'audius:one','provider':'audius','provider_id':'one','title':'One','artist':'Artist','artist_id':'artist','duration':180,'genre':'Ambient','playback_url':'https://example.com/audio'}

def room():
    state=new_room('host','Host','Distance');state['members']['guest']='Guest';return state

def test_host_only_queue_is_enforced():
    r=room()
    with pytest.raises(ValueError):apply(r,'guest',{'type':'enqueue','resolved_track':track()})
    assert r['queue']==[]

def test_everyone_queue_and_host_playback():
    r=room();apply(r,'host',{'type':'policy','policy':'everyone'})
    apply(r,'guest',{'type':'enqueue','resolved_track':track()})
    with pytest.raises(ValueError):apply(r,'guest',{'type':'next'})
    apply(r,'host',{'type':'next'});assert r['track']['id']=='audius:one'

@pytest.mark.parametrize('position',[float('nan'),float('inf'),-1,181])
def test_invalid_seek(position):
    with pytest.raises(ValueError):apply(room(),'host',{'type':'playback','resolved_track':track(),'position':position})

def test_voting_only_when_enabled():
    r=room();apply(r,'host',{'type':'enqueue','resolved_track':track()})
    with pytest.raises(ValueError):apply(r,'guest',{'type':'vote','id':r['queue'][0]['id']})

def test_chat_not_in_public_snapshot_and_end_erases_it():
    r=room();apply(r,'guest',{'type':'chat','text':'hi'})
    assert 'messages' not in public_state(r)
    apply(r,'host',{'type':'end'});assert r['messages']==[]
    with pytest.raises(ValueError):apply(r,'guest',{'type':'chat','text':'still here'})

def test_unknown_member_cannot_mutate():
    with pytest.raises(ValueError):apply(room(),'intruder',{'type':'chat','text':'hi'})

def test_feedback_excludes_artist_and_song():
    t=Track(**track())
    feedback=[{'kind':'never_artist','track_id':'audius:other','artist_id':t.artist_id,'provider':'audius','mood':''}]
    assert rank([t],feedback,'Unwind',[])==[]

def test_mood_rejection_scoped_to_mood():
    t=Track(**track());feedback=[{'kind':'not_this_mood','track_id':t.id,'artist_id':t.artist_id,'provider':t.provider,'mood':'Focus'}]
    assert rank([t],feedback,'Focus',[])==[]
    assert len(rank([t],feedback,'Energy',[]))==1

def test_gated_provider_tracks_are_not_playable():
    with pytest.raises(ValueError):Audius().normalize({'is_stream_gated':True})

def test_anonymous_room_creation_rejected():
    response=TestClient(app).post('/api/rooms',json={'mode':'Distance'})
    assert response.status_code==401

def test_missing_dedicated_config_fails_closed(monkeypatch):
    monkeypatch.delenv('SUPABASE_URL',raising=False)
    response=TestClient(app).post('/api/rooms',json={},headers={'Authorization':'Bearer fake'})
    assert response.status_code==503

def test_turns_rotate_all_contributors():
    r=room();r['members']['third']='Third'
    apply(r,'host',{'type':'policy','policy':'turns'})
    for member in ('host','host','guest','guest','third','third'):
        apply(r,member,{'type':'enqueue','resolved_track':track()})
    turns=[]
    for _ in range(6):
        apply(r,'host',{'type':'next'});turns.append(r['last_turn'])
    assert turns==['host','guest','third','host','guest','third']

def test_audius_failure_uses_jamendo_when_configured(monkeypatch):
    from .providers import PROVIDERS, search_catalog
    class Failed:
        async def search(self,query): raise ValueError('Unavailable')
    class Fallback:
        async def search(self,query): return [Track(**track())]
    monkeypatch.setenv('JAMENDO_CLIENT_ID','test')
    monkeypatch.setitem(PROVIDERS,'audius',Failed())
    monkeypatch.setitem(PROVIDERS,'jamendo',Fallback())
    assert len(asyncio.run(search_catalog('evening')))==1

def test_audius_failure_without_fallback_is_honest(monkeypatch):
    from .providers import PROVIDERS, search_catalog
    class Failed:
        async def search(self,query): raise ValueError('Unavailable')
    monkeypatch.delenv('JAMENDO_CLIENT_ID',raising=False)
    monkeypatch.setitem(PROVIDERS,'audius',Failed())
    with pytest.raises(ValueError,match='unavailable'):
        asyncio.run(search_catalog('evening'))

@pytest.mark.parametrize('wrapped',[False,True])
def test_audius_single_track_response(monkeypatch,wrapped):
    provider=Audius()
    item={'id':'one','title':'One','user':{'id':'artist','name':'Artist'},'duration':180}
    async def request(path,params=None):
        assert path=='/tracks/one'
        return [item] if wrapped else item
    monkeypatch.setattr(provider,'request',request)
    assert asyncio.run(provider.track('one')).id=='audius:one'

def test_context_ranking_explains_first_party_and_weather():
    calm=Track(**track())
    energetic=calm.model_copy(update={'id':'audius:two','genre':'Electronic'})
    items=rank([energetic,calm],[],'Focus',[],12,23,61,'winter',['Ambient'])
    assert items[0]['track']['id']==calm.id
    assert 'A gentle match for rainy weather' in items[0]['reasons']
    assert 'A genre from your saved music' in items[0]['reasons']

def test_play_next_is_host_only_and_removal_is_owned():
    r=room();apply(r,'host',{'type':'policy','policy':'everyone'})
    apply(r,'guest',{'type':'enqueue','resolved_track':track()})
    with pytest.raises(ValueError): apply(r,'guest',{'type':'enqueue_next','resolved_track':track()})
    apply(r,'host',{'type':'enqueue_next','resolved_track':{**track(),'id':'audius:next'}})
    assert r['queue'][0]['track']['id']=='audius:next'
    with pytest.raises(ValueError): apply(r,'guest',{'type':'remove','id':r['queue'][0]['id']})
    apply(r,'guest',{'type':'remove','id':r['queue'][1]['id']})
    assert len(r['queue'])==1

def test_reactions_toggle_and_expire_with_chat():
    r=room();apply(r,'guest',{'type':'chat','text':'A moment'})
    event={'type':'react','id':r['messages'][0]['id'],'emoji':'❤️'}
    apply(r,'host',event);assert r['messages'][0]['reactions']['❤️']==['host']
    apply(r,'host',event);assert r['messages'][0]['reactions']['❤️']==[]
    apply(r,'host',{'type':'end'});assert r['messages']==[]
