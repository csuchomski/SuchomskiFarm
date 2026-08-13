import { herdSchema, supabase } from "./supabase";

/**
 * Monitoring photographs: upload, and getting one back to look at.
 *
 * The bucket is **private** (migration 041). A photo of a key area is a record
 * of somebody's ground, and on a small farm it is a record of their home, so
 * nothing is served from a public URL — the app asks for a short-lived signed
 * one each time it shows a picture.
 *
 * **The path carries the tenancy.** `storage.objects` has no farm column for
 * RLS to attach to, so the first path segment is the farm id and the policies
 * compare it against membership. That means the path is a security-relevant
 * value: it is generated here from the farm id the caller is already scoped
 * to, never taken from a filename or anything else a user typed.
 */

const BUCKET = "grazing-photos";

/** Signed URLs are deliberately short-lived. Long enough to look at a photo
 * and scroll back to it, short enough that a copied link is not a lasting
 * hole in a private bucket. */
const SIGNED_URL_SECONDS = 60 * 10;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** The bucket also enforces this; checking here means a clear message rather
 * than an opaque storage error. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export function photoRejection(file: { type: string; size: number }): string | null {
  if (!(file.type in EXTENSIONS)) {
    return "That is not an image this app takes — a JPEG or PNG from a phone is what it expects.";
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB, and the limit is ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // jsdom and older Safari. Only used to keep object names apart, never as a
  // security boundary — the farm prefix is what the policies check.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Put a photo in the bucket and attach it to a monitoring record.
 *
 * Two writes that are not in one transaction, because one of them is not in
 * the database. The object goes up first: an orphaned object is a wasted
 * megabyte, whereas a row pointing at a file that was never stored is a
 * broken record that looks whole.
 */
export async function uploadMonitoringPhoto(input: {
  farmId: string;
  monitoringRecordId: string;
  file: File;
  caption?: string;
  takenAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<{ id: string; storagePath: string }> {
  const rejection = photoRejection(input.file);
  if (rejection !== null) throw new Error(rejection);

  const ext = EXTENSIONS[input.file.type];
  // The farm id comes from the caller's own workspace, never from the file.
  const storagePath = `${input.farmId}/${input.monitoringRecordId}/${newId()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, input.file, { contentType: input.file.type, upsert: false });
  if (upErr) throw new Error(`Could not store the photo: ${upErr.message}`);

  const { data, error } = await herdSchema()
    .from("grazing_photos")
    .insert({
      farm_id: input.farmId,
      monitoring_record_id: input.monitoringRecordId,
      storage_path: storagePath,
      caption: input.caption?.trim() || null,
      taken_at: input.takenAt ?? new Date().toISOString(),
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  return { id: (data as { id: string }).id, storagePath };
}

/** A short-lived URL for one photo. Null rather than throwing when it cannot
 * be signed — a missing thumbnail should not take a page of records down. */
export async function signedPhotoUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  return error || !data ? null : data.signedUrl;
}

/** Signed URLs for a batch, keyed by storage path. Misses are simply absent,
 * so a caller renders what it got and leaves a gap for what it did not. */
export async function signedPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error || !data) return out;

  for (const row of data) {
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
  }
  return out;
}
