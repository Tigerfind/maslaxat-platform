const fs = require('fs');
const {
  buildApprovalAttestation,
  validateApprovalRun,
  validateDispatchInput,
  validateProofRun,
  validateSourceRun,
  verifySourceAttestation,
} = require('../services/paymentEvidenceProvenance');

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (![
    'validate-dispatch', 'validate-source-run', 'validate-proof-run', 'validate-approval-run',
    'verify-source', 'build-approval',
  ].includes(command)) {
    throw new Error('Unsupported payment provenance command');
  }
  const options = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${flag || ''}`);
    const name = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!['input', 'output', 'expectations', 'keyFile', 'keyId', 'now', 'run'].includes(name)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    options[name] = value;
  }
  if (!options.input || !options.output) throw new Error('--input and --output are required');
  if (['validate-source-run', 'validate-proof-run', 'validate-approval-run'].includes(command) && !options.expectations) {
    throw new Error(`${command} requires --expectations`);
  }
  if (command === 'verify-source' && (!options.keyFile || !options.keyId || !options.now || !options.run)) {
    throw new Error('verify-source requires key, time, and verified run');
  }
  return options;
}

function readPrivate(file) {
  const stat = fs.statSync(file);
  if ((stat.mode & 0o077) !== 0) throw new Error(`Private provenance input must be mode 0600: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(readPrivate(file));
}

function writePrivate(file, value) {
  try {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Output already exists: ${file}`);
    throw error;
  }
}

function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let output;
  if (options.command === 'validate-dispatch') output = validateDispatchInput(readJson(options.input));
  else if (options.command === 'build-approval') output = buildApprovalAttestation(readJson(options.input));
  else if (options.command === 'validate-source-run') output = validateSourceRun(readJson(options.input), readJson(options.expectations));
  else if (options.command === 'validate-proof-run') output = validateProofRun(readJson(options.input), readJson(options.expectations));
  else if (options.command === 'validate-approval-run') output = validateApprovalRun(readJson(options.input), readJson(options.expectations));
  else {
    output = verifySourceAttestation(readJson(options.input), {
      publicKey: readPrivate(options.keyFile),
      keyId: options.keyId,
      now: new Date(options.now),
      run: readJson(options.run),
    });
  }
  writePrivate(options.output, output);
  return output;
}

if (require.main === module) {
  try { runCli(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, runCli };
