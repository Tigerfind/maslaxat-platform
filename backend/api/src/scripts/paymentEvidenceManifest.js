const fs = require('fs');
const {
  collectShadowEvents,
  loadScenarioInventory,
} = require('../services/paymentShadowEvidence');
const {
  generateUnsignedManifest,
  signCanonicalArtifact,
  signManifest,
  verifyCanonicalArtifact,
  verifyManifest,
} = require('../services/paymentEvidenceManifest');

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['collect', 'generate', 'sign', 'verify', 'sign-artifact', 'verify-artifact'].includes(command)) {
    throw new Error('Unsupported payment evidence command');
  }
  const options = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${flag || ''}`);
    const name = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (![
      'input', 'output', 'keyFile', 'keyId', 'expectations', 'kind', 'digestField', 'streamMetadata',
      'paymentApprovalKeyFile', 'releaseApprovalKeyFile', 'paymentApprovalRunFile',
      'releaseApprovalRunFile', 'proofRunFile', 'now',
    ].includes(name)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    options[name] = value;
  }
  if (!options.input || !options.output) throw new Error('--input and --output are required');
  if (command === 'collect' && !options.streamMetadata) throw new Error('collect requires --stream-metadata');
  if (command === 'generate' && (!options.paymentApprovalKeyFile || !options.releaseApprovalKeyFile
    || !options.paymentApprovalRunFile || !options.releaseApprovalRunFile || !options.proofRunFile || !options.now)) {
    throw new Error('generate requires approval public keys, verified runs, and --now');
  }
  if (['sign', 'sign-artifact'].includes(command) && (!options.keyFile || !options.keyId)) {
    throw new Error('sign requires --key-file and --key-id');
  }
  if (['verify', 'verify-artifact'].includes(command) && !options.keyFile) throw new Error('verify requires --key-file');
  if (command === 'verify' && !options.now) throw new Error('verify requires --now');
  if (command === 'verify-artifact' && (!options.kind || !options.digestField)) {
    throw new Error('verify-artifact requires --kind and --digest-field');
  }
  return options;
}

function readPrivate(file) {
  const stat = fs.statSync(file);
  if ((stat.mode & 0o077) !== 0) throw new Error(`Private evidence input must be mode 0600: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function writePrivate(file, value) {
  try {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Output already exists: ${file}`);
    throw error;
  }
}

function runCli(argv = process.argv.slice(2), _env = process.env) {
  const options = parseArgs(argv);
  let output;
  if (options.command === 'collect') {
    const lines = readPrivate(options.input).split('\n').filter((line) => line.trim());
    output = collectShadowEvents(
      lines.map((line) => JSON.parse(line)),
      loadScenarioInventory(),
      JSON.parse(readPrivate(options.streamMetadata)),
    );
  } else if (options.command === 'generate') {
    output = generateUnsignedManifest(JSON.parse(readPrivate(options.input)), {
      now: new Date(options.now),
      approvalKeys: {
        payment_owner: {
          publicKey: readPrivate(options.paymentApprovalKeyFile), keyId: 'payment_owner-key-v1',
        },
        release_owner: {
          publicKey: readPrivate(options.releaseApprovalKeyFile), keyId: 'release_owner-key-v1',
        },
      },
      approvalRuns: {
        payment_owner: JSON.parse(readPrivate(options.paymentApprovalRunFile)),
        release_owner: JSON.parse(readPrivate(options.releaseApprovalRunFile)),
      },
      proofRun: JSON.parse(readPrivate(options.proofRunFile)),
    });
  } else if (options.command === 'sign') {
    output = signManifest(JSON.parse(readPrivate(options.input)), {
      privateKey: readPrivate(options.keyFile),
      keyId: options.keyId,
    });
  } else if (options.command === 'verify') {
    const expectations = options.expectations ? JSON.parse(readPrivate(options.expectations)) : {};
    output = verifyManifest(JSON.parse(readPrivate(options.input)), {
      ...expectations,
      publicKey: readPrivate(options.keyFile),
      now: new Date(options.now),
    });
  } else if (options.command === 'sign-artifact') {
    output = signCanonicalArtifact(JSON.parse(readPrivate(options.input)), {
      privateKey: readPrivate(options.keyFile), keyId: options.keyId,
    });
  } else {
    output = verifyCanonicalArtifact(JSON.parse(readPrivate(options.input)), {
      publicKey: readPrivate(options.keyFile), kind: options.kind, digestField: options.digestField,
    });
  }
  writePrivate(options.output, output);
  return output;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, runCli };
