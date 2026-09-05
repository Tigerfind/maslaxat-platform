import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sw = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');
const offline = readFileSync(resolve(__dirname, '../../public/offline.html'), 'utf8');

describe('service worker privacy and offline policy', () => {
  test('precache is an explicit public shell and private routes bypass Cache Storage', () => {
    expect(sw).toContain("'/offline.html'");
    expect(sw).toContain("url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')");
    expect(sw).not.toContain("url.pathname.startsWith('/assets/')");
    expect(sw).toContain("!response.headers.has('Set-Cookie')");
  });

  test('failed navigation uses the guaranteed offline page instead of a partial cached shell', () => {
    expect(sw).toContain("return caches.match('/offline.html')");
    expect(sw).not.toContain("return (await caches.match('/index.html'))");
    expect(offline).toContain('<main class="card">');
    expect(offline).toContain('No private data is stored on this page.');
  });

  test('push tags retain consultation and message identity', () => {
    expect(sw).toContain('data.metadata?.consultationId');
    expect(sw).toContain('data.metadata?.messageId || data.metadata?.id');
    expect(sw).toContain('candidate.pathname');
    expect(sw).toContain('candidate.search');
    expect(sw).toContain('candidate.hash');
  });
});
