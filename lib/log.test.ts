import { describe, expect, it } from "vitest";
import { createLogger, readLogLevel, serializeError, type LoggerOptions } from "./log";

function capture(level: LoggerOptions["level"] = "debug") {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    write: (l) => void lines.push(l),
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });
  return { logger, lines, parsed: () => lines.map((l) => JSON.parse(l)) };
}

describe("createLogger", () => {
  it("writes one JSON object per line with ts, level, event first", () => {
    const { logger, lines, parsed } = capture();
    logger.info("request.received", { route: "simulate", ipHash: "abc" });
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('{"ts":"2026-01-02T03:04:05.000Z","level":"info","event":"request.received"')).toBe(true);
    expect(parsed()[0]).toEqual({
      ts: "2026-01-02T03:04:05.000Z",
      level: "info",
      event: "request.received",
      route: "simulate",
      ipHash: "abc",
    });
  });

  it("drops entries below the threshold", () => {
    const { logger, lines } = capture("warn");
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    expect(lines.map((l) => JSON.parse(l).event)).toEqual(["c", "d"]);
  });

  it("emits nothing when silent", () => {
    const { logger, lines } = capture("silent");
    logger.error("boom");
    expect(lines).toEqual([]);
  });

  it("re-reads a level function on every call", () => {
    let level: "debug" | "silent" = "silent";
    const { logger, lines } = capture(() => level);
    logger.info("hidden");
    level = "debug";
    logger.info("shown");
    expect(lines.map((l) => JSON.parse(l).event)).toEqual(["shown"]);
  });

  it("does not let fields override the reserved keys", () => {
    const { logger, parsed } = capture();
    logger.info("real", { event: "fake", level: "error" });
    expect(parsed()[0].event).toBe("real");
    expect(parsed()[0].level).toBe("info");
  });
});

describe("readLogLevel", () => {
  it("defaults to info and accepts known levels case-insensitively", () => {
    expect(readLogLevel({})).toBe("info");
    expect(readLogLevel({ GENIE_LOG_LEVEL: "DEBUG" })).toBe("debug");
    expect(readLogLevel({ GENIE_LOG_LEVEL: "loud" })).toBe("info");
  });
});

describe("serializeError", () => {
  it("captures name, message and stack for errors and stringifies anything else", () => {
    const e = serializeError(new TypeError("bad"));
    expect(e.name).toBe("TypeError");
    expect(e.message).toBe("bad");
    expect(e.stack).toContain("bad");
    expect(serializeError("oops")).toEqual({ name: "NonError", message: "oops" });
  });
});
