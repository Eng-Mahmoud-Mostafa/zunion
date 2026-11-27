export const logoutKey="zunion-explicit-logout-v1";
export const authSessionKey="zunion-local-session";
/** Server-backed cache copies only. Local-only business records/preferences are preserved. */
export function clearAuthCaches(serverBacked:boolean) {
 localStorage.removeItem(authSessionKey);
 if(!serverBacked)return;
 for(const key of ["zunion-local-orders-v2","zunion-local-customers-v1","zunion-local-finance-v1","zunion-local-products-v1","zunion-local-parties-v1","zunion-local-transactions-v1","zunion-local-audit-v1","zunion-local-reset-v1","zunion-local-passwords-v1","zunion-managed-users-v1","zunion-managed-roles-v1","zunion-local-recent-searches-v1","zunion-local-recent-orders-v1","zunion-local-recent-customers-v1","zunion-local-search-cache-v1"]){localStorage.removeItem(key);}
 const url=import.meta.env.VITE_SUPABASE_URL;
 if(url){const ref=new URL(url).hostname.split(".")[0];for(const suffix of ["","-code-verifier","-user"]){const key=`sb-${ref}-auth-token${suffix}`;localStorage.removeItem(key);sessionStorage.removeItem(key);}}
}
