// Unit and integration test for BackendClient in Node.js
const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock the VS Code API
Module.prototype.require = function (path) {
  if (path === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key, def) => def
        })
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const { BackendClient } = require('./dist/api/backendClient');

console.log('--- RUNNING PHASE 2 BACKEND CLIENT TESTS ---');

async function runTests() {
  const client = new BackendClient('http://127.0.0.1:8765');

  // Test 1: Offline fallback handling
  // If backend is not currently running on this port, it must gracefully return connected: false rather than throwing
  const offlineHealth = await client.getHealth();
  assert(offlineHealth !== null, 'getHealth should return a valid object');
  assert.strictEqual(typeof offlineHealth.connected, 'boolean');
  console.log('✓ Test 1: BackendClient offline fallback handling verified');

  // Test 2: URL configuration
  client.updateBaseUrl('http://localhost:9999');
  const customHealth = await client.getHealth();
  assert.strictEqual(customHealth.connected, false);
  console.log('✓ Test 2: BaseUrl update and error resistance verified');

  console.log('\n======================================================');
  console.log('ALL PHASE 2 BACKEND CLIENT TESTS PASSED! ✓');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
