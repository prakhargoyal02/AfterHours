alter table public.music_passes add column kind text not null default 'tracks' check(kind in ('tracks','profile'));
alter table public.music_passes drop constraint music_passes_tracks_check;
alter table public.music_passes add constraint music_pass_payload check(
 jsonb_typeof(tracks)='array' and ((kind='tracks' and jsonb_array_length(tracks) between 1 and 100) or (kind='profile' and jsonb_array_length(tracks)=0)));
create or replace function public.redeem_music_pass(pass_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare pass public.music_passes; playlist uuid; shared_profile jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select * into pass from public.music_passes where code=pass_code for update;
 if pass.id is null or not private.not_blocked(pass.user_id) then raise exception 'Pass unavailable'; end if;
 if pass.expires_at<=now() or pass.remaining_uses<=0 then raise exception 'Pass expired or already used'; end if;
 if pass.kind='profile' then
   select jsonb_build_object('id',id,'username',username,'display_name',display_name,'bio',bio) into shared_profile
   from public.profiles where id=pass.user_id and visibility='public';
   if shared_profile is null then raise exception 'This profile is no longer public'; end if;
   update public.music_passes set remaining_uses=remaining_uses-1 where id=pass.id;
   return jsonb_build_object('profile',shared_profile);
 end if;
 update public.music_passes set remaining_uses=remaining_uses-1 where id=pass.id;
 insert into public.playlists(user_id,title) values(auth.uid(),'From a Music Pass') returning id into playlist;
 insert into public.playlist_items(playlist_id,track_id,track,position)
 select playlist,item->>'id',item,(ordinality-1)::integer
 from jsonb_array_elements(pass.tracks) with ordinality as tracks(item,ordinality)
 on conflict(playlist_id,track_id) do nothing;
 return jsonb_build_object('playlist_id',playlist);
end $$;
revoke all on function public.redeem_music_pass(text) from public,anon;
grant execute on function public.redeem_music_pass(text) to authenticated;
