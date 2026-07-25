import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL;

const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Supabase URL atau publishable key belum terbaca dari .env.local"
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabaseKey
);

supabase.auth
  .getSession()
  .then(({ error }) => {
    if (error) {
      console.error(
        "Koneksi Supabase gagal:",
        error.message
      );
      return;
    }

    console.log("SUPABASE CONNECTED");
  });