import { createClient } from "@supabase/supabase-js";

// Next.js only inlines NEXT_PUBLIC_ variables that are written out in full.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// The client stores the session in the browser and refreshes the token. It is
// null until both values are set (see .env.example), so the app still builds
// and the login page can say what is missing.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
