"""Provider metadata only. Audio goes directly from authorized source to listener."""
import os
from typing import Protocol
from urllib.parse import quote
import httpx
from pydantic import BaseModel

class Track(BaseModel):
    id: str
    provider: str
    provider_id: str
    title: str
    artist: str
    artist_id: str
    artwork: str | None = None
    duration: float = 0
    genre: str = ''
    playback: str = 'audio'
    playback_url: str
    permalink: str = ''

class MusicProvider(Protocol):
    async def search(self, query: str) -> list[Track]: ...
    async def track(self, identifier: str) -> Track: ...

class Audius:
    base = 'https://api.audius.co/v1'
    async def request(self, path, params=None):
        headers = {'X-API-Key': os.environ['AUDIUS_API_KEY']} if os.getenv('AUDIUS_API_KEY') else {}
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(self.base + path, params=params, headers=headers)
            response.raise_for_status()
            return response.json()['data']
    def normalize(self, item):
        if item.get('is_stream_gated') or item.get('is_unlisted') or item.get('is_delete') or item.get('is_available') is False:
            raise ValueError('This track is not available for public playback.')
        identifier = str(item['id'])
        return Track(id='audius:' + identifier, provider='audius', provider_id=identifier,
            title=item['title'], artist=item['user']['name'], artist_id=str(item['user']['id']),
            artwork=(item.get('artwork') or {}).get('480x480'), duration=item.get('duration', 0),
            genre=item.get('genre') or '', playback_url=f'{self.base}/tracks/{quote(identifier, safe="")}/stream',
            permalink='https://audius.co' + item.get('permalink', ''))
    async def search(self, query):
        items = await self.request('/tracks/search' if query else '/tracks/trending', {'query':query,'limit':24} if query else {'limit':24})
        results = []
        for item in items:
            try: results.append(self.normalize(item))
            except ValueError: continue
        return results
    async def track(self, identifier):
        data = await self.request('/tracks/' + quote(identifier, safe=''))
        # The single-track endpoint returns an object; bulk/search return arrays.
        if isinstance(data, list):
            if not data: raise ValueError('Track not found.')
            data = data[0]
        if not isinstance(data, dict): raise ValueError('Track not found.')
        return self.normalize(data)

class Jamendo:
    async def request(self, params):
        if not os.getenv('JAMENDO_CLIENT_ID'): raise ValueError('Jamendo is not configured.')
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get('https://api.jamendo.com/v3.0/tracks/', params={
                'client_id':os.environ['JAMENDO_CLIENT_ID'], 'format':'json', 'limit':24, **params})
            response.raise_for_status()
            return response.json()['results']
    def normalize(self, item):
        return Track(id='jamendo:'+item['id'], provider='jamendo', provider_id=item['id'],
            title=item['name'], artist=item['artist_name'], artist_id=item['artist_id'],
            artwork=item.get('image'), duration=item['duration'], playback_url=item['audio'],
            permalink=item.get('shareurl', ''))
    async def search(self, query):
        return [self.normalize(x) for x in await self.request({'search':query})]
    async def track(self, identifier):
        data = await self.request({'id':identifier})
        if not data: raise ValueError('Track not found.')
        return self.normalize(data[0])

# Licensed adapters implement this contract when access exists.
PROVIDERS: dict[str, MusicProvider] = {'audius':Audius(), 'jamendo':Jamendo()}

async def search_catalog(query: str, provider: str = 'audius') -> list[Track]:
    """Try Audius first; fall back to configured Jamendo on failure or no results."""
    candidates = [provider]
    if provider == 'audius' and os.getenv('JAMENDO_CLIENT_ID'):
        candidates.append('jamendo')
    failure = None
    for name in candidates:
        try:
            tracks = await PROVIDERS[name].search(query)
            if tracks:
                return tracks
        except (httpx.HTTPError, ValueError, KeyError) as error:
            failure = error
    if failure:
        raise ValueError('Music sources are unavailable. Please try again shortly.') from failure
    return []

async def resolve(track_id: str) -> Track:
    provider, separator, identifier = track_id.partition(':')
    if not separator or provider not in PROVIDERS or not identifier or len(identifier) > 100:
        raise ValueError('Unknown music provider or track.')
    return await PROVIDERS[provider].track(identifier)
