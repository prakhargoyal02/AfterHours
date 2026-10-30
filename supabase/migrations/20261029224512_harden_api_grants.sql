-- Supabase can grant anon directly via default privileges; revoking PUBLIC alone is insufficient.
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke execute on function public.redeem_music_pass(text) from anon;
revoke execute on function public.room_members_allowed(uuid[]) from anon;
-- These two RPCs intentionally require authenticated callers and check auth.uid()/blocks.
