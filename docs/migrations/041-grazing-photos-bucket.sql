-- 041 — a private bucket for monitoring photos
--
-- STATUS: run 2026-08-13
--
-- The first use of Supabase Storage in this app, so the reasoning is worth
-- writing down rather than assumed from the code.
--
-- CPS 528 monitoring wants a photo series from a fixed point on a fixed
-- bearing. A photo of a key area is a record of somebody's ground, and on a
-- small farm it is a record of somebody's home — so the bucket is **private**.
-- Nothing here is served from a public URL; the app asks for a short-lived
-- signed URL each time it shows one.
--
-- **Tenancy lives in the object path.** Every object is stored under
-- `<farm_id>/...`, and the policies below compare that first path segment
-- against the caller's farm membership. That is the only workable shape:
-- `storage.objects` has no farm column to attach RLS to, so the path *is* the
-- tenancy key and the policies have to treat it as one.
--
-- Note what this does and does not stop. It stops a member of one farm
-- reading or writing another farm's photos, which is the whole point of RLS
-- here. It does not stop a member of a farm from writing a wrongly-named file
-- inside their own prefix — that is an application concern, and the app
-- generates the path rather than taking one.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'grazing-photos',
  'grazing-photos',
  false,
  -- A phone photo, not a raw file. Large enough for a full-resolution JPEG
  -- from a modern handset and small enough that a mistake is bounded.
  15 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── the policies ───────────────────────────────────────────────────────
--
-- `storage.foldername(name)` splits the object path; element 1 is the first
-- segment, which by our convention is the farm id. It is cast rather than
-- compared as text so a malformed prefix fails to match instead of matching
-- something unexpected.

create or replace function herd.storage_path_farm(object_name text)
returns uuid
language plpgsql
immutable
as $function$
declare
  v_first text;
begin
  v_first := (storage.foldername(object_name))[1];
  if v_first is null then
    return null;
  end if;
  return v_first::uuid;
exception when others then
  -- A path that does not start with a uuid belongs to no farm, and a policy
  -- comparing against null denies rather than throws.
  return null;
end;
$function$;

drop policy if exists grazing_photos_select on storage.objects;
create policy grazing_photos_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'grazing-photos'
    and herd.is_farm_member(herd.storage_path_farm(name))
  );

drop policy if exists grazing_photos_insert on storage.objects;
create policy grazing_photos_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'grazing-photos'
    and herd.can_write_farm(herd.storage_path_farm(name))
  );

drop policy if exists grazing_photos_update on storage.objects;
create policy grazing_photos_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'grazing-photos'
    and herd.can_write_farm(herd.storage_path_farm(name))
  )
  with check (
    bucket_id = 'grazing-photos'
    and herd.can_write_farm(herd.storage_path_farm(name))
  );

-- No delete policy, matching every table in 036. A monitoring record that can
-- be quietly removed is a record a reviewer cannot rely on, and the same goes
-- for the photograph attached to it. Removing one is a deliberate act through
-- the dashboard, by somebody who means it.
