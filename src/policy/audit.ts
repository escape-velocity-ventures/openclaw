/**
 * Audit logger for policy engine.
 *
 * Logs every tool call, skill load attempt, and policy decision
 * to a structured JSON file and optional webhook.
 */

import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { AuditEntry, PolicyState } from "./types.js";

const log = createSubsystemLogger("policy-audit");

/** In-memory buffer for testing / inspection. */
const auditBuffer: AuditEntry[] = [];
const MAX_BUFFER_SIZE = 1000;

/**
 * Log an audit entry to file, webhook, and internal buffer.
 */
export async function auditLog(policy: PolicyState, entry: AuditEntry): Promise<void> {
  // Buffer for testing
  auditBuffer.push(entry);
  if (auditBuffer.length > MAX_BUFFER_SIZE) {
    auditBuffer.shift();
  }

  const line = JSON.stringify(entry);

  // File logging
  const logFile = policy.definition.audit?.logFile;
  if (logFile) {
    try {
      const dir = path.dirname(logFile);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.appendFile(logFile, line + "\n");
    } catch (err) {
      log.error(`Failed to write audit log to ${logFile}: ${String(err)}`);
    }
  }

  // Webhook
  const webhookUrl = policy.definition.audit?.webhookUrl;
  if (webhookUrl) {
    try {
      // Fire-and-forget, don't block on webhook
      void fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: line,
        signal: AbortSignal.timeout(5000),
      }).catch((err) => {
        log.error(`Audit webhook failed: ${String(err)}`);
      });
    } catch {
      // Ignore webhook errors
    }
  }

  log.debug(`audit: ${entry.event} ${entry.decision} ${entry.target}`);
}

/**
 * Get the audit buffer (for testing).
 */
export function getAuditBuffer(): readonly AuditEntry[] {
  return auditBuffer;
}

/**
 * Clear the audit buffer (for testing).
 */
export function clearAuditBuffer(): void {
  auditBuffer.length = 0;
}

/**
 * Sanitize tool arguments for audit logging.
 * Redacts values that look like secrets/tokens.
 */
export function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const SECRET_PATTERNS = /password|secret|token|key|auth|credential|apikey|api_key/i;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (SECRET_PATTERNS.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 500) {
      sanitized[key] = value.slice(0, 200) + "...[truncated]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = "[object]";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
