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

    // Stdio MCP protocol reserves stdout for JSON-RPC frames.
    // Write all internal logs to stderr to prevent stream corruption.
    try {
      process.stderr.write(`[spector:${level.toUpperCase()}] ${JSON.stringify(entry)}\n`);
    } catch {
      // Ignore write errors while stderr stream is closing.
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
      if (error.cause instanceof Error) {
        errorDetails.cause = error.cause.message;
      }
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
}

export const logger = TelemetryLogger.getInstance();
