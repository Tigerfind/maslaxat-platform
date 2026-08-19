const { spawn } = require('child_process');

const MAX_TEXT_CHARS = 100000;
const inputPath = process.argv[2];

if (!inputPath) process.exit(2);

const child = spawn('/usr/bin/pdftotext', ['-enc', 'UTF-8', '-nopgbrk', inputPath, '-'], {
  shell: false,
  stdio: ['ignore', 'pipe', 'ignore'],
  env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
});
const chunks = [];
let characters = 0;
let failed = false;

child.stdout.on('data', (chunk) => {
  characters += chunk.toString('utf8').length;
  if (characters > MAX_TEXT_CHARS) {
    failed = true;
    child.kill('SIGKILL');
    return;
  }
  chunks.push(chunk);
});
child.on('error', () => process.exit(2));
child.on('close', (code, signal) => {
  if (failed || code !== 0 || signal) process.exit(2);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.length > MAX_TEXT_CHARS) process.exit(2);
  process.stdout.write(JSON.stringify({ text }));
});
