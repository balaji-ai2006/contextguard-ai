import { RuntimeSnapshot, VariableSnapshotItem } from '../models/types';

export class ExtensionSnapshotManager {
  private snapshots: Map<string, RuntimeSnapshot> = new Map();
  private order: string[] = [];
  private maxHistorySize: number = 50;
  private captureEnabled: boolean = false;
  private backendTransmissionEnabled: boolean = false;

  private static readonly SENSITIVE_KEYWORDS = [
    'password', 'passwd', 'pwd', 'secret', 'token', 'auth', 'api_key',
    'apikey', 'access_token', 'refresh_token', 'private_key', 'client_secret',
    'database_url', 'db_pass', 'conn_str', 'credentials', 'authorization', 'bearer'
  ];

  private static readonly SECRET_PATTERNS: Array<{ pattern: RegExp; tag: string }> = [
    { pattern: /sk-[a-zA-Z0-9_-]{20,}/g, tag: '[REDACTED_API_KEY]' },
    { pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, tag: '[REDACTED_GITHUB_TOKEN]' },
    { pattern: /AKIA[0-9A-Z]{16}/g, tag: '[REDACTED_AWS_KEY]' },
    { pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, tag: '[REDACTED_JWT_TOKEN]' },
    { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, tag: '[REDACTED_PRIVATE_KEY]' }
  ];

  constructor(maxHistorySize: number = 50) {
    this.maxHistorySize = Math.max(1, maxHistorySize);
  }

  public isCaptureEnabled(): boolean {
    return this.captureEnabled;
  }

  public setCaptureEnabled(enabled: boolean): void {
    this.captureEnabled = enabled;
  }

  public isBackendTransmissionEnabled(): boolean {
    return this.backendTransmissionEnabled;
  }

  public setBackendTransmissionEnabled(enabled: boolean): void {
    this.backendTransmissionEnabled = enabled;
  }

  public setMaxHistorySize(size: number): void {
    this.maxHistorySize = Math.max(1, size);
    this.evictExcess();
  }

  public getMaxHistorySize(): number {
    return this.maxHistorySize;
  }

  public addSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
    // Redact variables BEFORE storing in memory
    const sanitizedSnapshot = this.sanitizeSnapshot(snapshot);
    const id = sanitizedSnapshot.snapshotId || `snap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    sanitizedSnapshot.snapshotId = id;

    if (this.snapshots.has(id)) {
      const idx = this.order.indexOf(id);
      if (idx !== -1) this.order.splice(idx, 1);
    }

    this.snapshots.set(id, sanitizedSnapshot);
    this.order.push(id);
    this.evictExcess();
    return sanitizedSnapshot;
  }

  public getSnapshot(id: string): RuntimeSnapshot | undefined {
    return this.snapshots.get(id);
  }

  public listSnapshots(limit?: number): RuntimeSnapshot[] {
    const reversedIds = [...this.order].reverse();
    const targetIds = limit && limit > 0 ? reversedIds.slice(0, limit) : reversedIds;
    return targetIds.map(id => this.snapshots.get(id)!).filter(Boolean);
  }

  public clearSnapshots(): number {
    const count = this.snapshots.size;
    this.snapshots.clear();
    this.order = [];
    return count;
  }

  public count(): number {
    return this.snapshots.size;
  }

  public sanitizeSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
    const sanitized: RuntimeSnapshot = {
      ...snapshot,
      timestamp: snapshot.timestamp || new Date().toISOString(),
      language: snapshot.language || 'python',
      captureStatus: snapshot.captureStatus || 'success',
      variableSnapshots: {}
    };

    const vars = snapshot.variableSnapshots || {};
    const sanitizedVars: Record<string, VariableSnapshotItem> = {};

    for (const [name, item] of Object.entries(vars)) {
      sanitizedVars[name] = this.sanitizeVariable(name, item);
    }

    // Also populate backwards compatible variables map if present
    if (snapshot.variables) {
      sanitized.variables = {};
      for (const [name, valObj] of Object.entries(snapshot.variables)) {
        const item: VariableSnapshotItem = {
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

  public sanitizeVariable(name: string, item: VariableSnapshotItem): VariableSnapshotItem {
    const lowerName = name.toLowerCase().replace(/[-_]/g, '');
    const isSensitiveName = ExtensionSnapshotManager.SENSITIVE_KEYWORDS.some(kw => 
      lowerName.includes(kw.replace(/[-_]/g, ''))
    );

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

  private evictExcess() {
    while (this.order.length > this.maxHistorySize) {
      const oldestId = this.order.shift();
      if (oldestId) {
        this.snapshots.delete(oldestId);
      }
    }
  }
}

export const extensionSnapshotManager = new ExtensionSnapshotManager(50);
