// Backend startup compatibility guard.
// Keep the original server.js intact. At startup, inject the one missing
// Mongo collection into the legacy db object before Node executes server.js.
'use strict';

const fs = require('fs');
const Module = require('module');

const serverPath = require.resolve('./server.js');
const originalLoader = Module._extensions['.js'];

Module._extensions['.js'] = function mariServerLoader(module, filename) {
  if (filename === serverPath) {
    let source = fs.readFileSync(filename, 'utf8');
    const marker = "sessions: database.collection('sessions'),";
    const injected = marker + "\n    loginAttempts: database.collection('loginAttempts'),";
    if (!source.includes("loginAttempts: database.collection('loginAttempts')")) {
      if (!source.includes(marker)) {
        throw new Error('server.js compatibility marker not found; refusing to start with an unknown backend layout');
      }
      source = source.replace(marker, injected);
    }
    return module._compile(source, filename);
  }
  return originalLoader(module, filename);
};

require(serverPath);
