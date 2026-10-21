const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function keyFor(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function readCache(cacheDir, key, ttlMs = DEFAULT_TTL_MS) {
  try {
    const file = path.join(cacheDir, `${keyFor(key)}.json`);
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > ttlMs) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function writeCache(cacheDir, key, value) {
  try {
    ensureDir(cacheDir);
    const file = path.join(cacheDir, `${keyFor(key)}.json`);
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  } catch (_) {}
}

module.exports = {
  readCache,
  writeCache,
};
