// add-person — let somebody into a farm, making them a login if they have none.
//
// Signups are closed and email confirmation is off, so there is no invitation
// an owner can send that proves the person on the other end owns the address.
// What an owner can do is stand next to their helper and hand them a password.
// This makes that password.
//
// The service-role key is used for exactly one thing — creating the login —
// and lives only here, on the server. Who may be let in, and as what, is
// decided by public.add_member running as the *caller*, so the database's own
// owner check is the one that counts, not a copy of it in this file.
//
// An address that already has a login keeps its password. Nothing here resets
// anybody's password; that would be a way to take over an account by
// "adding" it to a farm.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ROLES = new Set(["owner", "helper", "vet", "viewer"]);

// Bearer tokens, not cookies, so a wildcard origin gives nothing away.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Typed on a phone, read off a screen: no 0/o, 1/l/i. 16 characters from 31
// is about 79 bits.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "POST only." });

  const authorization = req.headers.get("Authorization");
  if (!authorization) return reply(401, { error: "Sign in first." });

  let body: { businessId?: unknown; email?: unknown; role?: unknown; firstName?: unknown; lastName?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "That request was not readable." });
  }

  const businessId = Number(body.businessId);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body.role === "string" ? body.role : "";
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";

  if (!Number.isInteger(businessId)) return reply(400, { error: "Which farm?" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: "That does not look like an email address." });
  if (!ROLES.has(role)) return reply(400, { error: `There is no role called ${role || "nothing"}.` });

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  // Checked before an account is made, so a non-owner cannot use this to
  // create logins at all. add_member checks again, and that is the check that
  // actually guards the farm.
  const { data: isOwner, error: ownerError } = await asCaller.rpc("is_business_owner", { bid: businessId });
  if (ownerError) return reply(401, { error: ownerError.message });
  if (isOwner !== true) return reply(403, { error: "Only the farm's owner can let somebody in." });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const password = generatePassword();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });

  let newUserId: string | null = null;
  if (created.error) {
    const exists =
      (created.error as { code?: string }).code === "email_exists" ||
      /already (been )?registered|already exists/i.test(created.error.message);
    if (!exists) return reply(500, { error: created.error.message });
  } else {
    newUserId = created.data.user?.id ?? null;
  }

  const { error: addError } = await asCaller.rpc("add_member", {
    p_business_id: businessId,
    p_email: email,
    p_role: role,
  });
  if (addError) {
    // A login made a moment ago for somebody who then could not be let in is
    // a login nobody asked for. Take it back.
    if (newUserId) await admin.auth.admin.deleteUser(newUserId);
    return reply(400, { error: addError.message });
  }

  return reply(200, newUserId ? { created: true, password } : { created: false, password: null });
});
