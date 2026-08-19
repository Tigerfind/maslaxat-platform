const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

const execFileAsync = promisify(execFile);
const PASSTHROUGH = [
  'PATH', 'HOME', 'TMPDIR', 'NODE_ENV', 'DATABASE_URL', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
  'DB_HOST', 'DB_PORT', 'DB_SSL', 'E2E_RUN_ID', 'E2E_CONFIRM_DATABASE', 'JWT_SECRET',
];

function seedEnvironment(source = process.env) {
  return Object.fromEntries(PASSTHROUGH.filter((name) => source[name] !== undefined).map((name) => [name, source[name]]));
}

async function runSeed(command, source = process.env) {
  const script = path.resolve(__dirname, '../../backend/api/src/seeds/e2e-seed.js');
  const { stdout } = await execFileAsync(process.execPath, [script, command], {
    env: seedEnvironment(source),
    maxBuffer: 1024 * 1024,
  });
  const output = stdout.trim();
  return output ? JSON.parse(output) : null;
}

module.exports = { runSeed, seedEnvironment };
