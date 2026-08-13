const FRONTEND = process.env.FRONTEND_URL || 'https://frontend-production-eb74.up.railway.app';
const API = process.env.API_URL || 'https://backend-production-fa8f.up.railway.app/api';

async function expectStatus(url, expected, checkRoot = false) {
  const response = await fetch(url, { redirect: 'manual' });
  if (response.status !== expected) throw new Error(`${url}: expected ${expected}, got ${response.status}`);
  if (checkRoot) {
    const body = await response.text();
    if (!body.includes('<div id="root"></div>')) throw new Error(`${url}: React root not found`);
  }
}

async function main() {
  const publicRoutes = ['/', '/login', '/register', '/forgot-password', '/terms', '/privacy', '/refund-policy'];
  for (const route of publicRoutes) await expectStatus(`${FRONTEND}${route}`, 200, true);

  await expectStatus(`${API}/health`, 200);
  await expectStatus(`${API}/lawyers?limit=1`, 200);
  await expectStatus(`${API}/consultations`, 401);
  await expectStatus(`${API}/documents`, 401);
  await expectStatus(`${API}/ai/chat/conversations`, 401);
  await expectStatus(`${API}/does-not-exist`, 404);

  console.log(`Smoke OK: ${publicRoutes.length} SPA routes and 6 API checks`);
}

main().catch((error) => {
  console.error(`Smoke failed: ${error.message}`);
  process.exit(1);
});
