-- One transaction keeps identity and listening preferences consistent.
alter table public.preferences add column onboarding_completed boolean not null default false;

create function public.save_listener_profile(
 p_username text, p_display_name text, p_bio text, p_visibility text,
 p_region text, p_languages text[], p_genres text[], p_artists text[],
 p_moods text[], p_history_enabled boolean
) returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to save your profile'; end if;
 if length(trim(p_display_name)) = 0 then raise exception 'Choose a display name'; end if;
 update public.profiles set username=lower(trim(p_username)), display_name=trim(p_display_name),
 bio=trim(p_bio), visibility=p_visibility where id=auth.uid();
 if not found then raise exception 'Profile is unavailable'; end if;
 update public.preferences set region=trim(p_region), languages=p_languages, genres=p_genres,
 artists=p_artists, moods=p_moods, history_enabled=p_history_enabled, onboarding_completed=true
 where user_id=auth.uid();
 if not found then raise exception 'Preferences are unavailable'; end if;
end;
$$;
revoke all on function public.save_listener_profile(text,text,text,text,text,text[],text[],text[],text[],boolean) from public,anon;
grant execute on function public.save_listener_profile(text,text,text,text,text,text[],text[],text[],text[],boolean) to authenticated;
