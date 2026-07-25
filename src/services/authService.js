import { supabase } from "../lib/supabase";

export async function login(
  email,
  password
) {
  const { data, error } =
    await supabase.auth.signInWithPassword({
      email,
      password,
    });

  if (error) {
    throw error;
  }

  return data;
}

export async function logout() {
  const { error } =
    await supabase.auth.signOut();

  if (error) {
    throw error;
  }
}

export async function getSession() {
  const {
    data: { session },
  } =
    await supabase.auth.getSession();

  return session;
}