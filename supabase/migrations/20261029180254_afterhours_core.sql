-- Apply ONLY to a new, dedicated AfterHours Supabase project.
do $$ begin
 if exists(select 1 from pg_tables where schemaname='public')
    or exists(select 1 from auth.users) then
   raise exception 'AfterHours requires a new, empty, dedicated Supabase project. Refusing to modify an existing application.';
 end if;
end $$;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique default ('listener_' || replace(gen_random_uuid()::text,'-','')),
 display_name text not null default 'Listener' check (char_length(display_name) between 1 and 80),
 avatar_path text, bio text not null default '' check (char_length(bio)<=500),
 visibility text not null default 'private' check (visibility in ('public','private')),
 created_at timestamptz not null default now(),
 constraint username_format check (username ~ '^[a-z0-9_]{3,48}$')
);
create table public.preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 region text not null default '', languages text[] not null default '{}',
 genres text[] not null default '{}', artists text[] not null default '{}',
 moods text[] not null default '{}', samewave_opt_in boolean not null default false,
 history_enabled boolean not null default true
);
create table public.blocks (
 user_id uuid references public.profiles(id) on delete cascade,
 target_id uuid references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(user_id,target_id), check(user_id<>target_id)
);
create function private.not_blocked(other_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.blocks where (user_id=auth.uid() and target_id=other_id) or (target_id=auth.uid() and user_id=other_id));
$$;
revoke all on function private.not_blocked(uuid) from public;
grant execute on function private.not_blocked(uuid) to authenticated;

create function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id, display_name) values(new.id, left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'Listener'),80));
 insert into public.preferences(user_id) values(new.id);
 return new;
end $$;
revoke all on function private.new_profile() from public;
create trigger afterhours_signup after insert on auth.users for each row execute function private.new_profile();

create table public.likes (
 user_id uuid references public.profiles(id) on delete cascade, track_id text not null,
 track jsonb not null check(jsonb_typeof(track)='object'), created_at timestamptz not null default now(),
 primary key(user_id,track_id)
);
create table public.playlists (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 120), visibility text not null default 'private' check(visibility in ('public','private')),
 created_at timestamptz not null default now()
);
create table public.playlist_items (
 id uuid primary key default gen_random_uuid(), playlist_id uuid not null references public.playlists(id) on delete cascade,
 track_id text not null, track jsonb not null, position integer not null default 0,
 unique(playlist_id,track_id)
);
create table public.listening_history (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 track_id text not null, track jsonb not null, listened_at timestamptz not null default now(),
 context text not null default '' check(char_length(context)<=300)
);
create table public.followed_artists (
 user_id uuid references public.profiles(id) on delete cascade, provider text not null,
 artist_id text not null, name text not null, primary key(user_id,provider,artist_id)
);
create table public.recommendation_feedback (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 track_id text not null, artist_id text not null, provider text not null, mood text not null default '',
 kind text not null check(kind in ('not_interested','less_like_this','never_artist','never_song','not_this_mood')),
 created_at timestamptz not null default now()
);
create table public.session_summaries (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 room_code text not null, mode text not null, tracks jsonb not null default '[]',
 participants jsonb not null default '[]', started_at timestamptz not null, ended_at timestamptz not null default now(),
 unique(user_id,room_code)
);
create table public.saved_queues (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 title text not null, tracks jsonb not null default '[]', created_at timestamptz not null default now()
);
create table public.memory_mixes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 title text not null, tracks jsonb not null default '[]', session_ids uuid[] not null default '{}',
 created_at timestamptz not null default now()
);
create table public.stories (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 track_id text not null, track jsonb not null, photo_path text,
 caption text not null default '' check(char_length(caption)<=160),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours',
 check(expires_at<=created_at+interval '24 hours')
);
create table public.follows (
 user_id uuid references public.profiles(id) on delete cascade, target_id uuid references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(user_id,target_id), check(user_id<>target_id)
);
create table public.reports (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 target_id uuid references public.profiles(id) on delete set null, reason text not null check(char_length(reason) between 1 and 1000),
 created_at timestamptz not null default now()
);
create table public.samewave_connections (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 target_id uuid references public.profiles(id) on delete set null,
 status text not null check(status in ('wave','hi','accepted','rejected')),
 created_at timestamptz not null default now()
);
-- Server-only writes: no client can manufacture a proximity connection or contact after rejection.
create table public.music_passes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 code text not null unique default replace(gen_random_uuid()::text,'-',''),
 tracks jsonb not null check(jsonb_typeof(tracks)='array' and jsonb_array_length(tracks) between 1 and 100),
 expires_at timestamptz not null default now()+interval '1 day',
 remaining_uses integer not null default 1 check(remaining_uses between 0 and 100),
 created_at timestamptz not null default now(),
 check(expires_at<=created_at+interval '30 days')
);

alter table public.profiles enable row level security;
grant select,insert,update,delete on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using (id=(select auth.uid()) or (visibility='public' and private.not_blocked(id)));
create policy profile_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));

alter table public.preferences enable row level security;
grant select,insert,update,delete on public.preferences to authenticated;
create policy owner_access on public.preferences for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.blocks enable row level security;
grant select,insert,update,delete on public.blocks to authenticated;
create policy owner_access on public.blocks for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.likes enable row level security;
grant select,insert,update,delete on public.likes to authenticated;
create policy owner_access on public.likes for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.playlists enable row level security;
grant select,insert,update,delete on public.playlists to authenticated;
create policy owner_access on public.playlists for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.listening_history enable row level security;
grant select,insert,update,delete on public.listening_history to authenticated;
create policy owner_access on public.listening_history for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.followed_artists enable row level security;
grant select,insert,update,delete on public.followed_artists to authenticated;
create policy owner_access on public.followed_artists for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.recommendation_feedback enable row level security;
grant select,insert,update,delete on public.recommendation_feedback to authenticated;
create policy owner_access on public.recommendation_feedback for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.session_summaries enable row level security;
grant select,insert,update,delete on public.session_summaries to authenticated;
create policy owner_access on public.session_summaries for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.saved_queues enable row level security;
grant select,insert,update,delete on public.saved_queues to authenticated;
create policy owner_access on public.saved_queues for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.memory_mixes enable row level security;
grant select,insert,update,delete on public.memory_mixes to authenticated;
create policy owner_access on public.memory_mixes for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.stories enable row level security;
grant select,insert,update,delete on public.stories to authenticated;
create policy owner_access on public.stories for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.follows enable row level security;
grant select,insert,update,delete on public.follows to authenticated;
create policy owner_access on public.follows for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.music_passes enable row level security;
grant select,insert,update,delete on public.music_passes to authenticated;
create policy owner_access on public.music_passes for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create policy public_playlists on public.playlists for select to authenticated using(visibility='public' and private.not_blocked(user_id));
alter table public.playlist_items enable row level security;
grant select,insert,update,delete on public.playlist_items to authenticated;
create policy item_read on public.playlist_items for select to authenticated using(exists(select 1 from public.playlists p where p.id=playlist_id));
create policy item_insert on public.playlist_items for insert to authenticated with check(exists(select 1 from public.playlists p where p.id=playlist_id and p.user_id=(select auth.uid())));
create policy item_update on public.playlist_items for update to authenticated using(exists(select 1 from public.playlists p where p.id=playlist_id and p.user_id=(select auth.uid()))) with check(exists(select 1 from public.playlists p where p.id=playlist_id and p.user_id=(select auth.uid())));
create policy item_delete on public.playlist_items for delete to authenticated using(exists(select 1 from public.playlists p where p.id=playlist_id and p.user_id=(select auth.uid())));
alter table public.reports enable row level security;
grant select,insert on public.reports to authenticated;
create policy report_read on public.reports for select to authenticated using(user_id=(select auth.uid()));
create policy report_insert on public.reports for insert to authenticated with check(user_id=(select auth.uid()));
alter table public.samewave_connections enable row level security;
grant select on public.samewave_connections to authenticated;
create policy connection_read on public.samewave_connections for select to authenticated using(user_id=(select auth.uid()));

create function public.redeem_music_pass(pass_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; owner uuid; playlist uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select user_id into owner from public.music_passes where code=pass_code;
 if owner is null or not private.not_blocked(owner) then raise exception 'Pass unavailable'; end if;
 update public.music_passes set remaining_uses=remaining_uses-1
 where code=pass_code and expires_at>now() and remaining_uses>0 returning tracks into result;
 if result is null then raise exception 'Pass expired or already used'; end if;
 insert into public.playlists(user_id,title) values(auth.uid(),'From a Music Pass') returning id into playlist;
 insert into public.playlist_items(playlist_id,track_id,track,position)
 select playlist, item->>'id', item, (ordinality-1)::integer
 from jsonb_array_elements(result) with ordinality as tracks(item,ordinality)
 on conflict (playlist_id,track_id) do nothing;
 return jsonb_build_object('playlist_id',playlist);
end $$;
revoke all on function public.redeem_music_pass(text) from public;
grant execute on function public.redeem_music_pass(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp']),
 ('story-photos','story-photos',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy media_read on storage.objects for select to authenticated using(bucket_id in ('avatars','story-photos') and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy media_insert on storage.objects for insert to authenticated with check(bucket_id in ('avatars','story-photos') and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy media_update on storage.objects for update to authenticated using(bucket_id in ('avatars','story-photos') and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id in ('avatars','story-photos') and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy media_delete on storage.objects for delete to authenticated using(bucket_id in ('avatars','story-photos') and (storage.foldername(name))[1]=(select auth.uid())::text);
create index history_owner_time on public.listening_history(user_id,listened_at desc);
create index playlist_owner on public.playlists(user_id);
create index blocks_target on public.blocks(target_id);
create index feedback_owner on public.recommendation_feedback(user_id);

create function public.room_members_allowed(member_ids uuid[]) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not exists(
   select 1 from unnest(member_ids) member where not private.not_blocked(member)
 );
$$;
revoke all on function public.room_members_allowed(uuid[]) from public;
grant execute on function public.room_members_allowed(uuid[]) to authenticated;

-- Blocked users cannot create social follows. A block also removes existing follows.
drop policy owner_access on public.follows;
create policy follows_read on public.follows for select to authenticated using(user_id=(select auth.uid()));
create policy follows_insert on public.follows for insert to authenticated with check(
 user_id=(select auth.uid()) and private.not_blocked(target_id) and
 exists(select 1 from public.profiles p where p.id=target_id and p.visibility='public'));
create policy follows_delete on public.follows for delete to authenticated using(user_id=(select auth.uid()));
create function private.block_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from public.follows where (user_id=new.user_id and target_id=new.target_id) or (user_id=new.target_id and target_id=new.user_id);
 return new;
end $$;
revoke all on function private.block_cleanup() from public;
create trigger afterhours_block after insert on public.blocks for each row execute function private.block_cleanup();

-- Tokens issued before deletion must not be able to upload orphaned media.
drop policy media_insert on storage.objects;
create policy media_insert on storage.objects for insert to authenticated with check(
 bucket_id in ('avatars','story-photos') and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.profiles where id=(select auth.uid())));

alter table public.profiles add constraint avatar_owner check(avatar_path is null or split_part(avatar_path,'/',1)=id::text);
alter table public.stories add constraint story_photo_owner check(photo_path is null or split_part(photo_path,'/',1)=user_id::text);
create policy public_stories on public.stories for select to authenticated using(
 expires_at>now() and private.not_blocked(user_id) and exists(select 1 from public.profiles p where p.id=user_id and p.visibility='public'));
create policy public_profile_media on storage.objects for select to authenticated using(
 bucket_id='avatars' and exists(select 1 from public.profiles p where p.avatar_path=name and p.visibility='public' and private.not_blocked(p.id)));
create policy public_story_media on storage.objects for select to authenticated using(
 bucket_id='story-photos' and exists(select 1 from public.stories s join public.profiles p on p.id=s.user_id
 where s.photo_path=name and s.expires_at>now() and p.visibility='public' and private.not_blocked(p.id)));
