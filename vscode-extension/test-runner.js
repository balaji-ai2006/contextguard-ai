// Unit tests for VS Code extension detectors, commands, and lifecycle
const Module = require('module');
const originalRequire = Module.prototype.require;

const registeredCommands = new Map();
let registeredWebviewProvider = null;
let registeredStatusBarItem = null;

// Mock the VS Code API for standalone headless unit testing
Module.prototype.require = function (path) {
  if (path === 'vscode') {
    return {
      DiagnosticSeverity: {
        Error: 0,
        Warning: 1,
        Information: 2,
        Hint: 3
      },
      StatusBarAlignment: {
        Right: 1,
        Left: 2
      },
      ProgressLocation: {
        Notification: 15
      },
      languages: {
        getDiagnostics: () => [],
        onDidChangeDiagnostics: (cb) => ({ dispose: () => {} })
      },
      window: {
        createStatusBarItem: (alignment, priority) => {
          registeredStatusBarItem = { alignment, priority, text: '', tooltip: '', show: () => {}, dispose: () => {} };
          return registeredStatusBarItem;
        },
        registerWebviewViewProvider: (viewId, provider, options) => {
          registeredWebviewProvider = { viewId, provider, options };
          return { dispose: () => {} };
        },
        showInformationMessage: () => Promise.resolve(),
        showWarningMessage: () => Promise.resolve(),
        showErrorMessage: () => Promise.resolve(),
        withProgress: (options, task) => task()
      },
      commands: {
        registerCommand: (commandId, handler) => {
          registeredCommands.set(commandId, handler);
          return { dispose: () => registeredCommands.delete(commandId) };
        },
        executeCommand: (commandId, ...args) => {
          if (registeredCommands.has(commandId)) {
            return registeredCommands.get(commandId)(...args);
          }
          return Promise.resolve();
        }
      },
      workspace: {
        getConfiguration: () => ({ get: (k, def) => def }),
        openTextDocument: () => Promise.resolve({}),
        workspaceFolders: [{ uri: { fsPath: 'C:\\test\\workspace' } }]
      },
      Uri: {
        file: (p) => ({ fsPath: p, scheme: 'file' })
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const { ErrorDetector } = require('./dist/detectors/errorDetector');
const { TerminalWatcher } = require('./dist/detectors/terminalWatcher');
const extension = require('./dist/extension');

console.log('--- RUNNING PHASE 1 EXTENSION TESTS ---');

// Test 1: Severity classification
assert.strictEqual(ErrorDetector.classifySeverity('Segmentation fault core dumped', 0), 'CRITICAL');
assert.strictEqual(ErrorDetector.classifySeverity('Potential SQL Injection vulnerability detected', 0), 'CRITICAL');
assert.strictEqual(ErrorDetector.classifySeverity('TypeError: cannot read property of null', 0), 'HIGH');
assert.strictEqual(ErrorDetector.classifySeverity('Warning: variable is unused', 1), 'MEDIUM');
console.log('✓ Test 1: Severity classification passed');

// Test 2: Error Type inference
assert.strictEqual(ErrorDetector.inferErrorType('TypeError: NoneType is not callable'), 'TypeError');
assert.strictEqual(ErrorDetector.inferErrorType('Variable items is None'), 'NullOrNoneError');
assert.strictEqual(ErrorDetector.inferErrorType('ReferenceError: x is not defined'), 'ReferenceError');
console.log('✓ Test 2: Error type inference passed');

// Test 3: Terminal traceback parsing for Python
let detectedBug = null;
const watcher = new TerminalWatcher((bug) => {
  detectedBug = bug;
});

const samplePythonTraceback = `
Traceback (most recent call last):
  File "app/service.py", line 42, in calculate_total
    return sum(item["price"] for item in items)
TypeError: 'NoneType' object is not iterable
`;

const result = watcher.feedData(samplePythonTraceback);
assert(result !== null, 'Traceback should be parsed');
assert.strictEqual(result.line, 42);
assert.strictEqual(result.errorType, 'TypeError');
assert(result.message.includes("'NoneType' object is not iterable"));
assert.strictEqual(result.severity, 'HIGH');
assert(detectedBug !== null);
console.log('✓ Test 3: Python terminal traceback parser passed');

// Test 4: Terminal traceback parsing for Node.js
const sampleNodeError = `
TypeError: Cannot read properties of undefined (reading 'price')
    at calculateTotal (C:/projects/app/cart.js:15:24)
    at Object.<anonymous> (C:/projects/app/index.js:5:1)
`;
const nodeResult = watcher.feedData(sampleNodeError);
assert(nodeResult !== null, 'Node traceback should be parsed');
assert.strictEqual(nodeResult.line, 15);
assert.strictEqual(nodeResult.column, 24);
assert.strictEqual(nodeResult.errorType, 'TypeError');
console.log('✓ Test 4: Node.js terminal traceback parser passed');

// Test 5: Extension lifecycle activation and command registration
const mockContext = {
  subscriptions: [],
  extensionUri: { fsPath: 'C:\\test\\extension' }
};

extension.activate(mockContext);
assert(registeredWebviewProvider !== null, 'Webview provider should be registered');
assert.strictEqual(registeredWebviewProvider.viewId, 'contextguard.sidebarView');
assert(registeredStatusBarItem !== null, 'Status bar item should be created');
assert(registeredStatusBarItem.text.includes('ContextGuard'), 'Status bar item text should identify ContextGuard');

// Verify all required commands are registered
const expectedCommands = [
  'contextguard.scanWorkspace',
  'contextguard.analyzeCurrentFile',
  'contextguard.reproduceAndFix',
  'contextguard.analyzeBug',
  'contextguard.generateFixes',
  'contextguard.simulateFixes',
  'contextguard.verifyFix',
  'contextguard.previewDiff',
  'contextguard.applyFix',
  'contextguard.rollback',
  'contextguard.startBackend',
  'contextguard.checkBackendStatus'
];

for (const cmd of expectedCommands) {
  assert(registeredCommands.has(cmd), `Command ${cmd} must be registered`);
}
console.log('✓ Test 5: Extension activation, status bar, and command registrations verified');

extension.deactivate();
console.log('✓ Test 6: Extension deactivation clean');

console.log('\n======================================================');
console.log('ALL PHASE 1 TESTS PASSED SUCCESSFULLY! ✓');
console.log('======================================================\n');
