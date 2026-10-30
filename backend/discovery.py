"""Explainable contextual ranking, not a trained model over provider catalogs."""
from datetime import datetime, timezone
from .providers import Track

def rank(tracks:list[Track],feedback:list[dict],mood:str,genres:list[str],temperature:float|None=None,
         local_hour:int|None=None,weather_code:int|None=None,season:str='',liked_genres:list[str]|None=None):
    results=[]
    for track in tracks:
        relevant=[f for f in feedback if (f['track_id']==track.id or (f['kind']=='never_artist' and f['artist_id']==track.artist_id and f['provider']==track.provider))]
        if any(f['kind'] in ('never_song','never_artist') for f in relevant): continue
        if any(f['kind']=='not_this_mood' and f['mood']==mood for f in relevant): continue
        score=0;reasons=[]
        if track.genre.lower() in [g.strip().lower() for g in genres]:
            score+=3;reasons.append('One of your preferred genres')
        calm=mood.lower() in ('unwind','focus','dreamy')
        if calm and any(g in track.genre.lower() for g in ('ambient','chill','classical','jazz')):
            score+=2;reasons.append('A gentler fit for '+mood.lower())
        if temperature is not None and temperature<18 and 'ambient' in track.genre.lower():
            score+=1;reasons.append('A softer sound for cooler weather')
        gentle=any(g in track.genre.lower() for g in ('ambient','chill','classical','jazz'))
        if local_hour is not None and (local_hour>=21 or local_hour<6) and gentle and calm:
            score+=1;reasons.append('A quieter sound for your late hours')
        if weather_code is not None and 51<=weather_code<=82 and gentle:
            score+=1;reasons.append('A gentle match for rainy weather')
        if season in ('autumn','winter') and gentle and calm:
            score+=.5;reasons.append('A slower atmosphere for '+season)
        if track.genre.lower() in [g.lower() for g in (liked_genres or [])]:
            score+=1;reasons.append('A genre from your saved music')
        score-=sum(3 if f['kind']=='not_interested' else 1 for f in relevant)
        results.append({'track':track.model_dump(),'score':score,'reasons':reasons or ['Explore something different']})
    return sorted(results,key=lambda r:-r['score'])
