import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// true solo si cargaste las dos variables en el .env
export const configured = Boolean(url && key);

export const supabase = configured ? createClient(url, key) : null;

const TABLE = "app_state";

// Avisa a la app si la base devolvió un error (o "" si salió bien).
function report(msg) {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("store-status", { detail: msg || "" }));
}

// Devuelve el value como string JSON (igual que localStorage), o null si no existe.
export async function storeGet(k) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("value")
      .eq("key", k)
      .maybeSingle();
    if (error) {
      report(error.message);
      return null;
    }
    report("");
    if (!data) return null;
    return typeof data.value === "string" ? data.value : JSON.stringify(data.value);
  } catch (e) {
    report(e.message || String(e));
    return null;
  }
}

// Recibe un string JSON, lo guarda como jsonb en la base.
export async function storeSet(k, val) {
  if (!supabase) return;
  let payload;
  try {
    payload = JSON.parse(val);
  } catch (e) {
    payload = val;
  }
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ key: k, value: payload, updated_at: new Date().toISOString() });
    if (error) {
      report(error.message);
      return;
    }
    report("");
  } catch (e) {
    report(e.message || String(e));
  }
}

// Devuelve las keys que empiezan con el prefijo (para el gráfico por mes).
export async function storeList(prefix) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("key")
      .like("key", prefix + "%");
    if (error) {
      report(error.message);
      return [];
    }
    return data ? data.map((r) => r.key) : [];
  } catch (e) {
    report(e.message || String(e));
    return [];
  }
}
