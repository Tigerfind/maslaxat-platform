const path = require('path');
const { verifyPdfDockerContract } = require('../src/scripts/verifyPdfDockerContract');

const apiRoot = path.resolve(__dirname, '..');

test('Docker contract pins immutable images, every direct package, and excludes build-time definitions', () => {
  expect(verifyPdfDockerContract({ apiRoot })).toMatchObject({
    builderImage: 'debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241',
    runtimeImage: 'node:22.18.0-bookworm-slim@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e',
    buildPackages: 13,
    runtimePackages: 12,
  });
});

test('Docker contract prepares a dedicated parser root and P3.5 smoke entrypoint', () => {
  const result = verifyPdfDockerContract({ apiRoot });
  expect(result).toMatchObject({
    parserRuntimeRoot: '/opt/pdf-runtime-root',
    smokeScript: 'pdf-toolchain/p3.5-smoke.sh',
    freshclamTimeoutSeconds: 60,
    definitionPreflight: 'src/scripts/checkPdfDefinitions.js',
  });
});
