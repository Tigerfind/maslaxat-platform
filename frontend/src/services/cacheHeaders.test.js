import fs from 'fs';
import path from 'path';

const frontendRoot = path.resolve(__dirname, '../..');

const read = (name) => fs.readFileSync(path.join(frontendRoot, name), 'utf8');

test('nginx revalidates the worker and shell while caching hashed static assets immutably', () => {
  const config = read('nginx.conf');

  for (const asset of ['sw.js', 'index.html', 'manifest.json']) {
    expect(config).toMatch(new RegExp(`location = /${asset.replace('.', '\\.')}`));
  }
  expect(config.match(/Cache-Control "no-cache, no-store, must-revalidate" always/g)).toHaveLength(4);
  expect(config).toMatch(/location \/assets\/[^\n]*\{[\s\S]*Cache-Control "public, max-age=31536000, immutable" always/);
  expect(config).toMatch(/location \/ \{[\s\S]*try_files \$uri \$uri\/ \/index\.html/);
});

test('Railway uses the Vite nginx Docker image', () => {
  const railway = JSON.parse(read('railway.json'));
  expect(railway.build).toEqual({ builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' });
  expect(railway.deploy.startCommand).toBeUndefined();
});
