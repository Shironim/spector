import process from 'node:process';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  tool?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export class TelemetryLogger {
  private static instance: TelemetryLogger | null = null;
  private currentLevel: LogLevel = 'info';

  private constructor() {
    const envLevel = (process.env.SPECTOR_LOG_LEVEL || '').toLowerCase() as LogLevel;
    if (envLevel && LEVEL_PRIORITY[envLevel] !== undefined) {
      this.currentLevel = envLevel;
    } else if (process.env.SPECTOR_DEBUG === '1' || process.env.DEBUG?.includes('spector')) {
      this.currentLevel = 'debug';
    }
  }

  public static getInstance(): TelemetryLogger {
    if (!TelemetryLogger.instance) {
      TelemetryLogger.instance = new TelemetryLogger();
    }
    return TelemetryLogger.instance;
  }

  public setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  public getLevel(): LogLevel {
    return this.currentLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.currentLevel];
  }

  private emit(level: LogLevel, event: string, extra?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...extra
    };

    // Stdio MCP protocol requires JSON-RPC on stdout.
    // ALL internal server logging MUST go to stderr to prevent stream corruption.
    try {
      process.stderr.write(`[spector:${level.toUpperCase()}] ${JSON.stringify(entry)}\n`);
    } catch {
      // Fallback in case stderr stream is closing
    }
  }

  public debug(event: string, extra?: Record<string, unknown>): void {
    this.emit('debug', event, extra);
  }

  public info(event: string, extra?: Record<string, unknown>): void {
    this.emit('info', event, extra);
  }

  public warn(event: string, extra?: Record<string, unknown>): void {
    this.emit('warn', event, extra);
  }

  public error(event: string, error?: Error | unknown, extra?: Record<string, unknown>): void {
    const errorDetails: Record<string, unknown> = {};
    if (error instanceof Error) {
      errorDetails.errorMessage = error.message;
      errorDetails.errorName = error.name;
      if (this.currentLevel === 'debug') {
        errorDetails.stack = error.stack;
      }
    } else if (error) {
      errorDetails.errorMessage = String(error);
    }

    this.emit('error', event, {
      ...errorDetails,
      ...extra
    });
  }

  /**
   * Times an async operation and logs its completion or failure.
   */
  public async measure<T>(
    toolOrOp: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const startTime = Date.now();
    this.debug('operation_started', { operation: toolOrOp, ...metadata });

    try {
      const result = await fn();
      const durationMs = Date.now() - startTime;
      this.info('operation_completed', { operation: toolOrOp, durationMs, ...metadata });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      this.error('operation_failed', err, { operation: toolOrOp, durationMs, ...metadata });
      throw err;
    }
  }
}

export const logger = TelemetryLogger.getInstance();
