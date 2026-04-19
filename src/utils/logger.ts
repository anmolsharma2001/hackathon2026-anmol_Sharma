// ============================================================
// utils/logger.ts — Structured logger with audit trail
// ============================================================

import * as fs from "fs";
import * as path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

class Logger {
  private level: LogLevel;
  private logPath: string;
  private entries: string[] = [];

  constructor() {
    this.level = (process.env.LOG_LEVEL as LogLevel) || "info";
    this.logPath = process.env.AUDIT_LOG_PATH || "./logs/audit_log.json";
    this.ensureLogDir();
  }

  private ensureLogDir() {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[this.level];
  }

  private format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    return `[${ts}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (!this.shouldLog(level)) return;
    const formatted = this.format(level, message, meta);
    const color = LEVEL_COLORS[level];
    console.log(`${color}${formatted}${RESET}`);
    this.entries.push(formatted);
  }

  debug(message: string, meta?: Record<string, unknown>) { this.log("debug", message, meta); }
  info(message: string, meta?: Record<string, unknown>) { this.log("info", message, meta); }
  warn(message: string, meta?: Record<string, unknown>) { this.log("warn", message, meta); }
  error(message: string, meta?: Record<string, unknown>) { this.log("error", message, meta); }

  ticket(ticketId: string, message: string, meta?: Record<string, unknown>) {
    this.info(`[Ticket ${ticketId}] ${message}`, meta);
  }

  toolCall(ticketId: string, tool: string, status: string, durationMs: number) {
    const icon = status === "success" ? "✅" : "❌";
    this.info(`[Ticket ${ticketId}] ${icon} Tool: ${tool} | Status: ${status} | ${durationMs}ms`);
  }

  saveRunLog(content: string) {
    fs.writeFileSync(this.logPath, content, "utf-8");
    this.info(`Audit log saved to ${this.logPath}`);
  }
}

export const logger = new Logger();
