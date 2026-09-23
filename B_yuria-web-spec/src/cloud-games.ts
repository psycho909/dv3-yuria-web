import { createClient, type User } from "@supabase/supabase-js";
import { isValidGameRecord, type RealGameRecordV1 } from "./real-game-record";

// This is a publishable browser key. No Supabase secret or service-role key belongs in this app.
const URL = "https://kihgibfacsvbmvvmohuc.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_grZn4H6Hl54gQfkbQ8rtzg_e7wHvbrD";
const client = createClient(URL, PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

export async function currentCloudUser(): Promise<User | null> {
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user;
}

export function watchCloudAuth(callback: (user: User | null) => void): () => void {
  const { data } = client.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
  return () => data.subscription.unsubscribe();
}

export async function signInWithGitHub(): Promise<void> {
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await client.auth.signInWithOAuth({ provider: "github", options: { redirectTo } });
  if (error) throw error;
}

export async function signOutCloud(): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function uploadRecordedGame(game: RealGameRecordV1, user: User): Promise<void> {
  if (!isValidGameRecord(game) || game.status !== "recorded") throw new Error("只有按下紀錄本局的完整牌局可以上傳。");
  const { data: existing, error: lookupError } = await client.from("real_games").select("revision,payload").eq("id", game.id).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) {
    if (JSON.stringify(existing.payload) === JSON.stringify(game)) return;
    if (existing.revision >= game.revision) throw new Error("雲端已有同版或較新的牌局；請先核對資料，未覆寫雲端。");
  }
  const row = { id: game.id, user_id: user.id, schema_version: 1, revision: game.revision, payload: game, updated_at: game.updatedAt };
  const { error } = existing
    ? await client.from("real_games").update(row).eq("id", game.id).eq("revision", existing.revision).select("id").single()
    : await client.from("real_games").insert(row);
  if (error) throw error;
}

export async function downloadRecordedGames(): Promise<RealGameRecordV1[]> {
  const { data, error } = await client.from("real_games").select("payload").order("updated_at", { ascending: false }).limit(1000);
  if (error) throw error;
  const games = (data ?? []).map(row => row.payload);
  if (!games.every(game => isValidGameRecord(game) && game.status === "recorded")) throw new Error("雲端含有不相容的牌局；未匯入本機。");
  return games as RealGameRecordV1[];
}
