import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "tankaj_admin";

function secret() {
  return process.env.CRON_SECRET || process.env.ADMIN_PASSWORD || "dev-secret";
}

export function createAdminToken() {
  const payload = JSON.stringify({
    role: "admin",
    exp: Date.now() + 1000 * 60 * 60 * 12,
  });

  const encoded = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", secret())
    .update(encoded)
    .digest("base64url");

  return `${encoded}.${sig}`;
}

export function verifyAdminToken(token?: string | null) {
  if (!token) return false;

  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return false;

  const expected = createHmac("sha256", secret())
    .update(encoded)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);

  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
    return payload?.role === "admin" && Number(payload?.exp) > Date.now();
  } catch {
    return false;
  }
}

export async function isAdminRequest() {
  if (process.env.NODE_ENV !== "production") return true;

  const cookieStore = await cookies();
  return verifyAdminToken(cookieStore.get(COOKIE_NAME)?.value);
}

export { COOKIE_NAME };
