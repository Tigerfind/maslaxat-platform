const { verifyClamDefinitions } = require('../services/linkedinPdfParser');

if (require.main === module) {
  verifyClamDefinitions()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { checkPdfDefinitions: verifyClamDefinitions };
