import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { AuditEvent } from "./types.js";

/**
 * JSONL audit logger for payment and policy events.
 */
export class AuditLogService {
  private readonly logPath: string;

  /**
   * Creates an audit logger.
   *
   * @param logPath - JSONL file path.
   */
  constructor(logPath: string) {
    this.logPath = logPath;
  }

  /**
   * Builds service from environment.
   *
   * @returns Audit logger instance.
   */
  static fromEnv(): AuditLogService {
    return new AuditLogService(process.env.AUDIT_LOG_PATH || "./logs/audit.log");
  }

  /**
   * Appends an audit record to disk as one JSON line.
   *
   * @param event - Audit payload.
   */
  async append(event: AuditEvent): Promise<void> {
    await mkdir(path.dirname(this.logPath), { recursive: true });
    await appendFile(this.logPath, `${JSON.stringify(event)}\n`, "utf8");
  }
}
