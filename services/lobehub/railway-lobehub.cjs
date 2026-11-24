/*
 * Railway start script for LobeHub (busybox + Node image, runs as the image's nextjs user).
 *
 * 1. Normalises form values that would otherwise stop the start (URL, secrets, port, e-mails).
 * 2. Runs LobeHub's own database migrations (/app/docker.cjs), retrying while Postgres starts.
 * 3. Provides JWKS_KEY (RS256 key set LobeHub signs internal JWTs and OIDC tokens with):
 *    the variable if set, else a key generated once and kept in Postgres.
 * 4. Sets the Railway Bucket CORS rule so browsers can upload files through presigned URLs.
 * 5. Creates the owner account from LOBEHUB_ADMIN_EMAIL / LOBEHUB_ADMIN_PASSWORD through a
 *    temporary server bound to 127.0.0.1, before the public port opens. Sign-up stays limited
 *    to AUTH_ALLOWED_EMAILS (always contains the owner), so nobody else can claim the instance.
 *    Changing LOBEHUB_ADMIN_PASSWORD later resets the owner's password on the next start.
 * 6. Hands over to upstream /app/startServer.js.
 * Secret values are never printed.
 */
"use strict";

const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const APP = "/app";
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const KV_TABLE = "railway_template_kv";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (msg) => console.log(`[railway] ${msg}`);
const warn = (msg) => console.warn(`[railway] WARNING: ${msg}`);

function deriveSecret(name, fallbackSeed) {
  const env = process.env;
  const value = (env[name] || "").trim();
  if (value.length >= 16) return;
  if (value) {
    warn(`${name} is shorter than 16 characters; using its SHA-256 instead.`);
    env[name] = crypto.createHash("sha256").update(value).digest("base64");
  } else if (fallbackSeed) {
    warn(`${name} is empty; deriving it from AUTH_SECRET. Set ${name} to a long random value.`);
    env[name] = crypto.createHash("sha256").update(`${name}:${fallbackSeed}`).digest("base64");
  } else {
    warn(`${name} is empty; using a random value, so sessions end on every restart. Set ${name}.`);
    env[name] = crypto.randomBytes(32).toString("base64");
  }
}

function normaliseEmails() {
  const env = process.env;
  let admin = (env.LOBEHUB_ADMIN_EMAIL || "").trim().toLowerCase();
  if (admin && !EMAIL.test(admin)) {
    warn("LOBEHUB_ADMIN_EMAIL is not a valid e-mail; no owner account is created until it is fixed.");
    admin = "";
  }
  env.LOBEHUB_ADMIN_EMAIL = admin;
  const listed = (env.AUTH_ALLOWED_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const allowed = [...new Set(admin ? [admin, ...listed] : listed)];
  if (allowed.length === 0) {
    // An empty list means "anyone may register" upstream: never start like that.
    warn("No LOBEHUB_ADMIN_EMAIL and no AUTH_ALLOWED_EMAILS: e-mail sign-up and login are disabled. Set LOBEHUB_ADMIN_EMAIL and redeploy.");
    env.AUTH_DISABLE_EMAIL_PASSWORD = "1";
    env.AUTH_ALLOWED_EMAILS = "nobody.invalid";
  } else {
    env.AUTH_ALLOWED_EMAILS = allowed.join(",");
    log(`sign-up limited to ${allowed.length} allowed e-mail/domain entr${allowed.length === 1 ? "y" : "ies"} (AUTH_ALLOWED_EMAILS)`);
  }
}

function normaliseEnv() {
  const env = process.env;
  let base = (env.APP_URL || "").trim().replace(/\/+$/, "");
  try {
    const url = new URL(base);
    if (!/^https?:$/.test(url.protocol)) throw new Error("scheme");
    base = url.origin;
  } catch {
    const fallback = env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:3210";
    if (base) warn(`APP_URL is not an http(s) URL; using ${fallback}`);
    base = fallback;
  }
  env.APP_URL = base;

  deriveSecret("AUTH_SECRET");
  deriveSecret("KEY_VAULTS_SECRET", env.AUTH_SECRET);

  const port = Number.parseInt(env.PORT || "", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== String(env.PORT).trim()) {
    if (env.PORT) warn(`PORT=${env.PORT} is not a valid port; using 3210`);
    env.PORT = "3210";
  }
  // Podman sets HOSTNAME to the container name; Next.js would bind to it.
  env.HOSTNAME = "::";
  env.INTERNAL_APP_URL = `http://localhost:${env.PORT}`;
  normaliseEmails();
  if (!env.DATABASE_URL) {
    console.error("[railway] ERROR: DATABASE_URL is empty. Reference the Postgres service variables.");
  }
}

function pgClient() {
  const { Client } = require(`${APP}/node_modules/pg`);
  return new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
}

async function withDb(fn) {
  const client = pgClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function migrate() {
  const deadline = Date.now() + 15 * 60 * 1000;
  for (let attempt = 1; ; attempt += 1) {
    const result = spawnSync(process.execPath, [`${APP}/docker.cjs`], { cwd: APP, env: process.env, stdio: "inherit" });
    if (result.status === 0) {
      log("database migrations applied");
      return;
    }
    if (Date.now() > deadline) throw new Error("database migrations kept failing for 15 minutes");
    warn(`migration attempt ${attempt} failed (Postgres may still be starting); retrying in 10 s`);
    await sleep(10000);
  }
}

async function kvGet(client, key) {
  const result = await client.query(`select value from ${KV_TABLE} where key = $1`, [key]);
  return result.rows[0] ? result.rows[0].value : null;
}

async function kvSet(client, key, value) {
  await client.query(
    `insert into ${KV_TABLE} (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`,
    [key, value],
  );
}

function validJwks(raw) {
  try {
    const keys = JSON.parse(raw).keys;
    return Array.isArray(keys) && keys.some((k) => k.alg === "RS256" && k.kty === "RSA" && k.d);
  } catch {
    return false;
  }
}

function generateJwks() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const meta = { alg: "RS256", kid: crypto.randomBytes(8).toString("hex"), use: "sig" };
  return JSON.stringify({ keys: [{ ...privateKey.export({ format: "jwk" }), ...meta }] });
}

async function ensureJwks(client) {
  const env = process.env;
  if (env.JWKS_KEY && env.JWKS_KEY.trim()) {
    if (validJwks(env.JWKS_KEY)) {
      log("JWKS_KEY taken from the variable");
      return;
    }
    warn("JWKS_KEY is not a JWKS with an RS256 private key; using the generated key instead.");
  }
  let stored = await kvGet(client, "jwks_key");
  if (!stored || !validJwks(stored)) {
    stored = generateJwks();
    await kvSet(client, "jwks_key", stored);
    log("generated an RS256 JWKS_KEY and stored it in Postgres (railway_template_kv)");
  } else {
    log("JWKS_KEY loaded from Postgres (railway_template_kv)");
  }
  env.JWKS_KEY = stored;
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

// Minimal AWS SigV4 request (PutBucketCors only).
async function s3Request(method, host, pathname, query, body, extraHeaders) {
  const region = process.env.S3_REGION || "us-east-1";
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash("sha256").update(body).digest("hex");
  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extraHeaders };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = names.map((h) => `${h}:${String(headers[h]).trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [method, pathname, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, crypto.createHash("sha256").update(canonical).digest("hex")].join("\n");
  let key = hmac(`AWS4${process.env.S3_SECRET_ACCESS_KEY}`, day);
  key = hmac(hmac(hmac(key, region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${process.env.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const { host: _host, ...sendHeaders } = headers;
  return fetch(`https://${host}${pathname}${query ? `?${query}` : ""}`, {
    method,
    headers: { ...sendHeaders, Authorization: authorization },
    body,
    signal: AbortSignal.timeout(20000),
  });
}

async function bucketCors() {
  const env = process.env;
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    log("file storage not configured (S3_* empty): file uploads stay off");
    return;
  }
  if ((env.S3_BUCKET_CORS || "true").toLowerCase() === "false") {
    log("S3_BUCKET_CORS=false: bucket CORS left unchanged");
    return;
  }
  const origins = [...new Set([env.APP_URL, ...(env.AUTH_TRUSTED_ORIGINS || "").split(",")]
    .map((value) => { try { return new URL(value.trim()).origin; } catch { return null; } })
    .filter(Boolean))];
  const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration><CORSRule>${origins
    .map((o) => `<AllowedOrigin>${xmlEscape(o)}</AllowedOrigin>`).join("")}<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
  let endpoint;
  try {
    endpoint = new URL(env.S3_ENDPOINT);
  } catch {
    warn("S3_ENDPOINT is not a URL; bucket CORS not set");
    return;
  }
  const pathStyle = env.S3_ENABLE_PATH_STYLE === "1";
  const host = pathStyle ? endpoint.host : `${env.S3_BUCKET}.${endpoint.host}`;
  const pathname = pathStyle ? `/${encodeURIComponent(env.S3_BUCKET)}` : "/";
  const md5 = crypto.createHash("md5").update(body).digest("base64");
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await s3Request("PUT", host, pathname, "cors=", body, { "content-md5": md5, "content-type": "application/xml" });
      if (response.ok) {
        log(`bucket CORS allows ${origins.join(", ")}`);
        return;
      }
      warn(`bucket CORS attempt ${attempt}/5: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    } catch (error) {
      warn(`bucket CORS attempt ${attempt}/5: ${error.message}`);
    }
    await sleep(3000 * attempt);
  }
  warn("bucket CORS not set; browser uploads may fail until the next restart");
}

async function waitHttp(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`temporary server exited with ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function scryptHash(password) {
  // Better Auth's default format: hex salt ":" hex scrypt(N=16384, r=16, p=1, 64 bytes).
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(password.normalize("NFKC"), salt, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 });
  return `${salt}:${key.toString("hex")}`;
}

async function createOwner(email, password) {
  const env = process.env;
  const port = "3999";
  const child = spawn(process.execPath, [`${APP}/server.js`], {
    cwd: APP,
    env: { ...env, PORT: port, HOSTNAME: "127.0.0.1", INTERNAL_APP_URL: `http://127.0.0.1:${port}` },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    await waitHttp(`http://127.0.0.1:${port}/api/version`, child, 300000);
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: env.APP_URL },
      body: JSON.stringify({ email, password, name: (env.LOBEHUB_ADMIN_NAME || "").trim() || "Admin" }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      throw new Error(`sign-up of the owner account failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    }
  } finally {
    child.kill("SIGKILL");
  }
}

async function bootstrapOwner(client) {
  const env = process.env;
  const email = env.LOBEHUB_ADMIN_EMAIL;
  if (!email) return;
  let password = env.LOBEHUB_ADMIN_PASSWORD || "";
  const valid = password.length >= 8 && password.length <= 64;
  const fingerprint = valid ? hmac(env.AUTH_SECRET, `owner-password:${email}:${password}`).toString("hex") : "";
  const found = await client.query("select id from users where lower(email) = $1 limit 1", [email]);
  if (!valid) {
    warn(found.rows.length
      ? "LOBEHUB_ADMIN_PASSWORD must be 8-64 characters; it was ignored and the owner keeps the current password."
      : "LOBEHUB_ADMIN_PASSWORD must be 8-64 characters. The owner login stays locked with a random password nobody knows; set a valid LOBEHUB_ADMIN_PASSWORD and redeploy to unlock it.");
  }
  if (found.rows.length === 0) {
    if (!valid) password = crypto.randomBytes(24).toString("base64url");
    await createOwner(email, password);
    if (valid) await kvSet(client, "owner_password_fp", fingerprint);
    log(`owner account ${email} created${valid ? "" : " (locked, see warning above)"}`);
    return;
  }
  if (!valid) return;
  const applied = await kvGet(client, "owner_password_fp");
  if (applied === fingerprint) {
    log(`owner account ${email} exists; password unchanged`);
    return;
  }
  const userId = found.rows[0].id;
  const updated = await client.query(
    "update accounts set password = $1, updated_at = now() where user_id = $2 and provider_id = 'credential'",
    [scryptHash(password), userId],
  );
  if (updated.rowCount === 0) {
    warn(`owner account ${email} has no e-mail/password login (SSO only?); LOBEHUB_ADMIN_PASSWORD not applied`);
    return;
  }
  await kvSet(client, "owner_password_fp", fingerprint);
  log(`owner account ${email}: password set from LOBEHUB_ADMIN_PASSWORD`);
}

async function prepare() {
  await migrate();
  await withDb(async (client) => {
    await client.query(`create table if not exists ${KV_TABLE} (key text primary key, value text not null)`);
    await ensureJwks(client);
  });
  await bucketCors();
  await withDb(bootstrapOwner);
}

async function main() {
  normaliseEnv();
  try {
    await prepare();
  } catch (error) {
    console.error(`[railway] ERROR: ${error.message}`);
    // Without migrations the app cannot serve; let Railway restart the deployment.
    if (/migrations kept failing/.test(error.message)) return setTimeout(() => process.exit(1), 5000);
    // The owner account may not exist yet: keep e-mail sign-up closed rather than open.
    warn("continuing with e-mail sign-up and login disabled; fix the error above and redeploy");
    process.env.AUTH_DISABLE_EMAIL_PASSWORD = "1";
    if (!process.env.JWKS_KEY) process.env.JWKS_KEY = generateJwks();
  }
  log(`starting LobeHub on [::]:${process.env.PORT} (${process.env.APP_URL})`);
  require(`${APP}/startServer.js`);
}

main().catch((error) => {
  console.error(`[railway] ERROR: ${error.message}`);
  setTimeout(() => process.exit(1), 5000);
});
