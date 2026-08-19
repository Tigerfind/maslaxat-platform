const webpack = require('webpack');
const { sentryWebpackPlugin } = require('@sentry/webpack-plugin');

const SOURCE_MAP_ENV = [
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_FRONTEND_PROJECT',
  'RAILWAY_GIT_COMMIT_SHA',
  'SENTRY_RELEASE',
  'REACT_APP_SENTRY_RELEASE',
];

module.exports = function override(config) {
  const sourceMapsEnabled = process.env.SENTRY_SOURCE_MAPS_ENABLED === '1';
  if (sourceMapsEnabled) {
    const missing = SOURCE_MAP_ENV.filter((name) => !process.env[name]);
    if (missing.length) {
      throw new Error(`Sentry source-map upload enabled but missing: ${missing.join(', ')}`);
    }
    const release = process.env.REACT_APP_SENTRY_RELEASE;
    if (process.env.RAILWAY_GIT_COMMIT_SHA !== release || process.env.SENTRY_RELEASE !== release) {
      throw new Error('Sentry release values must match REACT_APP_SENTRY_RELEASE exactly');
    }
    config.devtool = 'source-map';
    config.plugins.push(sentryWebpackPlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_FRONTEND_PROJECT,
      telemetry: false,
      release: { name: release },
      sourcemaps: {
        assets: './build/**',
        filesToDeleteAfterUpload: './build/**/*.map',
      },
    }));
  } else {
    config.devtool = false;
  }

  config.resolve.fallback = {
    ...config.resolve.fallback,
    process: require.resolve('process/browser.js'),
    buffer: require.resolve('buffer/'),
    stream: require.resolve('stream-browserify'),
  };

  config.plugins = [
    ...config.plugins,
    new webpack.ProvidePlugin({
      process: 'process/browser.js',
      Buffer: ['buffer', 'Buffer'],
    }),
  ];

  // Fix fullySpecified resolution for process/browser in ESM modules
  config.module.rules.push({
    test: /\.m?js$/,
    resolve: {
      fullySpecified: false,
    },
  });

  return config;
};
