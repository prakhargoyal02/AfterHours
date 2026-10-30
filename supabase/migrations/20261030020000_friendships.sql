create table public.friendships (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references public.profiles(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted')),
 created_at timestamptz not null default now(), check(sender_id<>recipient_id)
);
create unique index friendship_pair on public.friendships(least(sender_id,recipient_id),greatest(sender_id,recipient_id));
create index friendships_recipient on public.friendships(recipient_id);
alter table public.friendships enable row level security;
revoke all on public.friendships from anon,authenticated;
grant select,insert,delete on public.friendships to authenticated;
grant update(status) on public.friendships to authenticated;
create policy friendship_read on public.friendships for select to authenticated using(
 (sender_id=auth.uid() or recipient_id=auth.uid()) and private.not_blocked(case when sender_id=auth.uid() then recipient_id else sender_id end));
create policy friendship_request on public.friendships for insert to authenticated with check(
 sender_id=auth.uid() and status='pending' and private.not_blocked(recipient_id)
 and exists(select 1 from public.profiles where id=recipient_id and visibility='public'));
create policy friendship_accept on public.friendships for update to authenticated using(
 recipient_id=auth.uid() and status='pending' and private.not_blocked(sender_id))
 with check(recipient_id=auth.uid() and status='accepted' and private.not_blocked(sender_id));
create policy friendship_remove on public.friendships for delete to authenticated using(sender_id=auth.uid() or recipient_id=auth.uid());

create function private.is_friend(other_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.friendships where status='accepted' and
 ((sender_id=auth.uid() and recipient_id=other_id) or (recipient_id=auth.uid() and sender_id=other_id)));
$$;
revoke all on function private.is_friend(uuid) from public,anon;
grant execute on function private.is_friend(uuid) to authenticated;
create policy friend_profile on public.profiles for select to authenticated using(private.is_friend(id) and private.not_blocked(id));
create policy request_profile on public.profiles for select to authenticated using(
 private.not_blocked(id) and exists(select 1 from public.friendships f where f.sender_id=profiles.id and f.recipient_id=auth.uid()));
create policy incoming_follows on public.follows for select to authenticated using(target_id=auth.uid() and private.not_blocked(user_id));

create or replace function private.block_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from public.follows where (user_id=new.user_id and target_id=new.target_id) or (user_id=new.target_id and target_id=new.user_id);
 delete from public.friendships where (sender_id=new.user_id and recipient_id=new.target_id) or (sender_id=new.target_id and recipient_id=new.user_id);
 return new;
end $$;
