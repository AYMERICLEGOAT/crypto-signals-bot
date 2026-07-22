import { createClient } from "@supabase/supabase-js";
import { config } from "../config";

/**
 * Client Supabase partagé. Utilise la clé fournie dans .env — en production,
 * ce doit être la clé `service_role` (le bot a besoin d'écrire dans `users` /
 * `pending_payments` / `signals` indépendamment des policies RLS pensées pour
 * des clients publics). Cette clé ne doit JAMAIS être exposée côté client.
 */
export const supabase = createClient(config.supabase.url, config.supabase.key, {
  auth: { persistSession: false },
});
