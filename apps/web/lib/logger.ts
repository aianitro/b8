// Minimal structured logger — replaces the ad hoc `console.error('[tag]', ...)` calls this
// app started with. One JSON line per call, so sync/scheduler/chat logs are actually
// greppable/parseable instead of free text. `scope` mirrors the old bracketed tags
// (`[sync]`, `[chat]`, ...) so existing muscle memory for finding a subsystem's logs holds.
//
// Deliberately not pino: single-user, single-process, low-volume — a thin wrapper is enough
// and keeps the "raw building blocks, no framework for framework's sake" convention this repo
// already follows (raw `pg`, no ORM). See ROADMAP.md §2.

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

interface LogLine extends LogFields {
  time: string;
  level: LogLevel;
  scope: string;
  message: string;
}

// Pure: same clock-injection pattern as recurringHeuristic.ts, so this is unit-testable
// without stubbing global Date.
export function formatLogLine(
  level: LogLevel,
  scope: string,
  message: string,
  fields: LogFields = {},
  now: () => Date = () => new Date()
): LogLine {
  return { time: now().toISOString(), level, scope, message, ...fields };
}

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const SINKS: Record<LogLevel, (line: string) => void> = {
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel) => (message: string, fields?: LogFields) => {
    SINKS[level](JSON.stringify(formatLogLine(level, scope, message, fields)));
  };
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}
