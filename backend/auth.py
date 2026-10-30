"""Validate against the dedicated project's Auth service, including deleted users."""
import os
import httpx
from fastapi import Header, HTTPException

def settings():
    url, key = os.getenv('SUPABASE_URL', ''), os.getenv('SUPABASE_PUBLISHABLE_KEY', '')
    if not url or not key: raise HTTPException(503, 'Connect the dedicated AfterHours Supabase project first.')
    return url.rstrip('/'), key

async def authenticate(token: str):
    url, key = settings()
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(url+'/auth/v1/user', headers={'apikey':key, 'Authorization':'Bearer '+token})
    if response.status_code != 200: raise HTTPException(401, 'Please sign in again.')
    user = response.json()
    if not user.get('email_confirmed_at'): raise HTTPException(403, 'Verify your email before continuing.')
    return user

async def user(authorization: str = Header(default='')):
    if not authorization.startswith('Bearer '): raise HTTPException(401, 'Sign in to continue.')
    return await authenticate(authorization[7:])

async def rest(path, token, method='GET', data=None):
    url, key = settings()
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.request(method, url+'/rest/v1/'+path, json=data,
            headers={'apikey':key,'Authorization':'Bearer '+token,'Prefer':'return=representation'})
    if response.is_error: raise HTTPException(502, 'Your data could not be saved. Please try again.')
    return response.json() if response.content else None
