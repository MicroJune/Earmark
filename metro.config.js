const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'metro-debug.log');

// Clear previous log
fs.writeFileSync(LOG_FILE, `=== Metro Debug Log — ${new Date().toISOString()} ===\n\n`);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

const config = getDefaultConfig(__dirname);

// Intercept transformer to log slow modules
const originalTransformFile = config.transformer?.transformerPath;

config.reporter = {
  update(event) {
    switch (event.type) {
      case 'bundle_build_started':
        log(`BUNDLE_START  bundleDir=${event.bundleDetails?.bundleType} platform=${event.bundleDetails?.platform}`);
        break;
      case 'bundle_transform_progressed':
        log(`TRANSFORM     ${event.transformedFileCount}/${event.totalFileCount} (${Math.round((event.transformedFileCount / event.totalFileCount) * 100)}%)`);
        break;
      case 'bundle_build_done':
        log(`BUNDLE_DONE`);
        break;
      case 'bundle_build_failed':
        log(`BUNDLE_FAILED  error=${event.error?.message}`);
        break;
      case 'client_log':
        log(`CLIENT_LOG    level=${event.level} data=${JSON.stringify(event.data)}`);
        break;
      case 'dep_graph_loading':
        log(`DEP_GRAPH_LOADING`);
        break;
      case 'dep_graph_loaded':
        log(`DEP_GRAPH_LOADED`);
        break;
      case 'initialize_started':
        log(`INIT_START    port=${event.port}`);
        break;
      case 'initialize_done':
        log(`INIT_DONE`);
        break;
      case 'hmr_client_error':
        log(`HMR_ERROR     ${event.error?.message}`);
        break;
      default:
        log(`EVENT         type=${event.type}`);
        break;
    }
  },
};

module.exports = config;
