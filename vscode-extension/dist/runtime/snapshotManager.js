"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extensionSnapshotManager = exports.ExtensionSnapshotManager = void 0;
class ExtensionSnapshotManager {
    snapshots = new Map();
    order = [];
    maxHistorySize = 50;
    captureEnabled = false;
    backendTransmissionEnabled = false;
    static SENSITIVE_KEYWORDS = [
        'password', 'passwd', 'pwd', 'secret', 'token', 'auth', 'api_key',
        'apikey', 'access_token', 'refresh_token', 'private_key', 'client_secret',
        'database_url', 'db_pass', 'conn_str', 'credentials', 'authorization', 'bearer'
    ];
    static SECRET_PATTERNS = [
        { pattern: /sk-[a-zA-Z0-9_-]{20,}/g, tag: '[REDACTED_API_KEY]' },
        { pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, tag: '[REDACTED_GITHUB_TOKEN]' },
        { pattern: /AKIA[0-9A-Z]{16}/g, tag: '[REDACTED_AWS_KEY]' },
        { pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, tag: '[REDACTED_JWT_TOKEN]' },
        { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, tag: '[REDACTED_PRIVATE_KEY]' }
    ];
    constructor(maxHistorySize = 50) {
        this.maxHistorySize = Math.max(1, maxHistorySize);
    }
    isCaptureEnabled() {
        return this.captureEnabled;
    }
    setCaptureEnabled(enabled) {
        this.captureEnabled = enabled;
    }
    isBackendTransmissionEnabled() {
        return this.backendTransmissionEnabled;
    }
    setBackendTransmissionEnabled(enabled) {
        this.backendTransmissionEnabled = enabled;
    }
    setMaxHistorySize(size) {
        this.maxHistorySize = Math.max(1, size);
        this.evictExcess();
    }
    getMaxHistorySize() {
        return this.maxHistorySize;
    }
    addSnapshot(snapshot) {
        // Redact variables BEFORE storing in memory
        const sanitizedSnapshot = this.sanitizeSnapshot(snapshot);
        const id = sanitizedSnapshot.snapshotId || `snap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        sanitizedSnapshot.snapshotId = id;
        if (this.snapshots.has(id)) {
            const idx = this.order.indexOf(id);
            if (idx !== -1)
                this.order.splice(idx, 1);
        }
        this.snapshots.set(id, sanitizedSnapshot);
        this.order.push(id);
        this.evictExcess();
        return sanitizedSnapshot;
    }
    getSnapshot(id) {
        return this.snapshots.get(id);
    }
    listSnapshots(limit) {
        const reversedIds = [...this.order].reverse();
        const targetIds = limit && limit > 0 ? reversedIds.slice(0, limit) : reversedIds;
        return targetIds.map(id => this.snapshots.get(id)).filter(Boolean);
    }
    clearSnapshots() {
        const count = this.snapshots.size;
        this.snapshots.clear();
        this.order = [];
        return count;
    }
    count() {
        return this.snapshots.size;
    }
    sanitizeSnapshot(snapshot) {
        const sanitized = {
            ...snapshot,
            timestamp: snapshot.timestamp || new Date().toISOString(),
            language: snapshot.language || 'python',
            captureStatus: snapshot.captureStatus || 'success',
            variableSnapshots: {}
        };
        const vars = snapshot.variableSnapshots || {};
        const sanitizedVars = {};
        for (const [name, item] of Object.entries(vars)) {
            sanitizedVars[name] = this.sanitizeVariable(name, item);
        }
        // Also populate backwards compatible variables map if present
        if (snapshot.variables) {
            sanitized.variables = {};
            for (const [name, valObj] of Object.entries(snapshot.variables)) {
                const item = {
                    name,
                    type: valObj.type || 'unknown',
                    preview: String(valObj.value ?? 'None'),
                    truncated: false,
                    redacted: valObj.redacted ?? false
                };
                const s = this.sanitizeVariable(name, item);
                sanitized.variables[name] = {
                    type: s.type,
                    value: s.preview,
                    redacted: s.redacted
                };
            }
        }
        sanitized.variableSnapshots = sanitizedVars;
        return sanitized;
    }
    sanitizeVariable(name, item) {
        const lowerName = name.toLowerCase().replace(/[-_]/g, '');
        const isSensitiveName = ExtensionSnapshotManager.SENSITIVE_KEYWORDS.some(kw => lowerName.includes(kw.replace(/[-_]/g, '')));
        if (isSensitiveName) {
            return {
                name,
                type: item.type || 'unknown',
                preview: '[REDACTED_SECRET]',
                truncated: false,
                redacted: true
            };
        }
        let preview = item.preview ?? '';
        let wasRedacted = item.redacted ?? false;
        // Pattern-based secret redaction
        for (const { pattern, tag } of ExtensionSnapshotManager.SECRET_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(preview)) {
                pattern.lastIndex = 0;
                preview = preview.replace(pattern, tag);
                wasRedacted = true;
            }
        }
        // Preview length truncation guard (max 120 chars)
        let wasTruncated = item.truncated ?? false;
        if (preview.length > 120) {
            preview = preview.substring(0, 117) + '...';
            wasTruncated = true;
        }
        return {
            name,
            type: item.type || 'unknown',
            preview,
            truncated: wasTruncated,
            redacted: wasRedacted
        };
    }
    evictExcess() {
        while (this.order.length > this.maxHistorySize) {
            const oldestId = this.order.shift();
            if (oldestId) {
                this.snapshots.delete(oldestId);
            }
        }
    }
}
exports.ExtensionSnapshotManager = ExtensionSnapshotManager;
exports.extensionSnapshotManager = new ExtensionSnapshotManager(50);
//# sourceMappingURL=snapshotManager.js.map