import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key, { auth: { flowType: 'pkce' } }) : null;
export function database() {
  if (!supabase) throw new Error('Accounts are not connected yet. Configure the dedicated AfterHours Supabase project.');
  return supabase;
}
export async function currentToken() {
  return (await database().auth.getSession()).data.session?.access_token;
}
