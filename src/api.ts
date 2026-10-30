import { supabase } from './supabase';
export async function api<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<T> {
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
  const response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.detail || 'Connection unavailable. Start the AfterHours server and try again.'); }
  return response.json();
}
export type Room = { code: string; mode: string; host: string; members: {id: string; name: string}[]; track: string; playing: boolean; position: number; updated_at: number; revision: number; queue: {id: string; track: string; by: string; votes: string[]}[]; policy: string; closed: boolean };
export type Message = { id: string; name: string; text: string; track?: string };
