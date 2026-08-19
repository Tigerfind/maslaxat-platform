// Historical billing fields remain readable while the hold/capture model is retired.
function getCompatibilityReport() {
  return {
    model: 'hold-5min',
    pseudoCaptureEnabled: false,
    productionSource: false,
  };
}

module.exports = { getCompatibilityReport };
