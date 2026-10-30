-- Preserve old records; enforce the photo requirement on every new or changed story.
alter table public.stories add constraint story_requires_photo
check (photo_path is not null and length(trim(photo_path)) > 0) not valid;
