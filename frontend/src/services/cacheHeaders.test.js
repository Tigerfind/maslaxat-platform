import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const frontendRoot = path.resolve(__dirname, '../..');

const read = (name) => fs.readFileSync(path.join(frontendRoot, name), 'utf8');

const startServe = (configPath) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    path.join(frontendRoot, 'node_modules/serve/build/main.js'),
    '-s', 'build', '-l', 'tcp://127.0.0.1:0', '--no-clipboard', '--config', configPath,
  ], {
    cwd: frontendRoot,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let started = false;
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    reject(new Error(`serve startup timed out: ${output}`));
  }, 10000);
  const capture = (chunk) => {
    output += chunk.toString();
    if (!started && output.includes('Accepting connections')) {
      started = true;
      child.kill('SIGTERM');
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.on('exit', (code) => {
    clearTimeout(timeout);
    if (started) resolve(output);
    else reject(new Error(`serve exited ${code}: ${output}`));
  });
});

test('nginx revalidates the worker and shell while caching hashed static assets immutably', () => {
  const config = read('nginx.conf');

  for (const asset of ['sw.js', 'index.html', 'manifest.json']) {
    expect(config).toMatch(new RegExp(`location = /${asset.replace('.', '\\.')}`));
  }
  expect(config.match(/Cache-Control "no-cache, no-store, must-revalidate" always/g)).toHaveLength(4);
  expect(config).toMatch(/location \/static\/[^\n]*\{[\s\S]*Cache-Control "public, max-age=31536000, immutable" always/);
  expect(config).toMatch(/location \/ \{[\s\S]*try_files \$uri \$uri\/ \/index\.html/);
});

test('Railway serve resolves its config from the build directory and starts without ENOENT', async () => {
  const serveConfig = JSON.parse(read('serve.json'));
  const railway = JSON.parse(read('railway.json'));
  const headers = Object.fromEntries(serveConfig.headers.map(({ source, headers: values }) => [
    source,
    Object.fromEntries(values.map(({ key, value }) => [key, value])),
  ]));

  for (const asset of ['sw.js', 'index.html', 'manifest.json']) {
    expect(headers[asset]['Cache-Control']).toBe('no-cache, no-store, must-revalidate');
  }
  expect(headers['static/**']['Cache-Control']).toBe('public, max-age=31536000, immutable');
  expect(serveConfig.rewrites).toContainEqual({ source: '**', destination: '/index.html' });
  const configPath = railway.deploy.startCommand.match(/--config\s+(\S+)/)?.[1];
  await expect(startServe(configPath)).resolves.not.toMatch(/ENOENT/);
  expect(configPath).toBe('../serve.json');
});
