/**
 * Structured JSON logging — one object per line on stdout, no vendor.
 *
 *   {"ts":"2026-01-01T00:00:00.000Z","level":"info","event":"simulation.completed","engine":"llm",...}
 *
 * Events are dot-namespaced (`request.received`, `llm.failed`, ...) so they
 * grep cleanly. Levels: debug < info < warn < error. The threshold comes from
 * `GENIE_LOG_LEVEL` (default `info`; `silent` disables output). Anything the
 * user typed (idea text) is only ever logged at `debug`.
 *
 * The module is isomorphic on purpose: `lib/storage` runs in the browser, so
 * when there is no `process.stdout` the line goes to `console.log` instead.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  /** Threshold, or a function so it can be re-read per call (tests, env changes). */
  level?: LogLevel | (() => LogLevel);
  /** Sink for a single serialized line (no trailing newline). */
  write?: (line: string) => void;
  now?: () => Date;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error", "silent"]);

/** Reads `GENIE_LOG_LEVEL`, defaulting to `info`. */
export function readLogLevel(env: Record<string, string | undefined> = process.env): LogLevel {
  const raw = env.GENIE_LOG_LEVEL?.trim().toLowerCase();
  return raw && LEVELS.has(raw as LogLevel) ? (raw as LogLevel) : "info";
}

function defaultWrite(line: string): void {
  if (typeof process !== "undefined" && typeof process.stdout?.write === "function") {
    process.stdout.write(line + "\n");
  } else {
    console.log(line);
  }
}

/** Reduces an unknown thrown value to loggable fields (stack included for real errors). */
export function serializeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: "NonError", message: String(err) };
}

/** Creates a logger; the default `log` below is one of these bound to env + stdout. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? defaultWrite;
  const now = options.now ?? (() => new Date());
  const levelOf = typeof options.level === "function" ? options.level : () => (options.level as LogLevel | undefined) ?? "info";

  function emit(level: Exclude<LogLevel, "silent">, event: string, fields?: LogFields): void {
    if (ORDER[level] < ORDER[levelOf()]) return;
    // `ts`/`level`/`event` come first so lines are scannable; fields can't override them.
    const out: Record<string, unknown> = { ts: now().toISOString(), level, event };
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (!(key in out)) out[key] = value;
    }
    write(JSON.stringify(out));
  }

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}

/** The application logger. Level is re-read from the environment on every call. */
export const log: Logger = createLogger({ level: () => readLogLevel() });
