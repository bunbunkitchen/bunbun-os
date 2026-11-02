/**
 * Bunbun accounting — hard stop against accidental execution in production.
 * This is NOT a replacement for proper Supabase project isolation or IAM.
 *
 * No staging project is connected yet. Default is disabled.
 */
export const BUNBUN_PRODUCTION_SUPABASE_REF = "amgyogvqyuxzdpjseqsi";

export function isIsolatedAccountingStaging({
  stageFlag, projectUrl, stagingProjectRef, allowedOrigin,
  productionProjectRef = BUNBUN_PRODUCTION_SUPABASE_REF,
}) {
  if (stageFlag !== "isolated-staging" ||
    typeof stagingProjectRef !== "string" ||
    !/^[a-z]{20}$/.test(stagingProjectRef) ||
    stagingProjectRef === productionProjectRef ||
    typeof projectUrl !== "string" || !projectUrl ||
    typeof allowedOrigin !== "string" || !allowedOrigin) {
    return false;
  }
  try {
    const url = new URL(projectUrl);
    const origin = new URL(allowedOrigin);
    if (url.protocol !== "https:" ||
      url.hostname !== stagingProjectRef + ".supabase.co" ||
      url.pathname !== "/" ||
      url.username || url.password || url.search || url.hash ||
      !["https:", "http:"].includes(origin.protocol) ||
      origin.origin !== allowedOrigin ||
      (origin.hostname === "localhost" && origin.protocol !== "http:")) {
      return false;
    }
    // Only local development may use http; live staging must be HTTPS.
    if (origin.protocol === "http:" &&
      !["localhost", "127.0.0.1"].includes(origin.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}
