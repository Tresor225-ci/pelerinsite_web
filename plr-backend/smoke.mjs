const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080";

async function check(path, expectedStatus) {
  const url = `${base}${path}`;
  const resp = await fetch(url);
  const text = await resp.text();
  if (resp.status !== expectedStatus) {
    throw new Error(`${path} expected ${expectedStatus}, got ${resp.status}: ${text}`);
  }
  return { path, status: resp.status };
}

try {
  const results = [];
  results.push(await check("/health", 200));
  results.push(await check("/api/resources", 200));
  console.log("smoke:ok", results);
  process.exit(0);
} catch (e) {
  console.error("smoke:fail", e?.message || e);
  process.exit(1);
}
