/**
 * Policy hooks for skill loading and tool dispatch.
 *
 * These create filter functions that can be inserted into the existing
 * skill loading and tool dispatch pipelines.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import { auditLog } from "./audit.js";
import { sanitizeArgs } from "./audit.js";
import { checkSkillAllowed, checkToolAllowed, getPolicy, isKilled } from "./engine.js";
import type { AuditEntry, PolicyDecision } from "./types.js";

const log = createSubsystemLogger("policy-hooks");

/**
 * Create a skill filter function for the skill loading pipeline.
 *
 * Returns a function that takes a skill name and returns true if allowed.
 * Logs every decision to the audit log.
 */
export function createPolicySkillFilter(): (skillName: string) => boolean {
  return (skillName: string): boolean => {
    const decision = checkSkillAllowed(skillName);
    const policy = getPolicy();

    if (policy) {
      void auditLog(policy, {
        timestamp: new Date().toISOString(),
        event: "skill_load",
        decision: decision.allowed ? "allow" : "deny",
        target: skillName,
        meta: { reason: decision.reason },
      });
    }

    if (!decision.allowed) {
      log.warn(`Skill blocked by policy: ${skillName} — ${decision.reason}`);
    }

    return decision.allowed;
  };
}

/**
 * Create a tool filter/gate for the tool dispatch pipeline.
 *
 * Returns a function that checks if a tool call is allowed and logs it.
 * This should be called BEFORE the tool executes.
 */
export function createPolicyToolFilter(): (
  toolName: string,
  args?: Record<string, unknown>,
) => PolicyDecision {
  return (toolName: string, args?: Record<string, unknown>): PolicyDecision => {
    const decision = checkToolAllowed(toolName);
    const policy = getPolicy();

    if (policy) {
      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        event: "tool_call",
        decision: decision.allowed ? "allow" : "deny",
        target: toolName,
        meta: { reason: decision.reason },
      };

      if (args && policy.definition.audit?.includeArgs) {
        entry.args = sanitizeArgs(args);
      }

      void auditLog(policy, entry);
    }

    if (!decision.allowed) {
      log.warn(`Tool blocked by policy: ${toolName} — ${decision.reason}`);
    }

    return decision;
  };
}

/**
 * Guard for new message acceptance. Returns false if agent is killed.
 */
export function shouldAcceptMessage(): boolean {
  if (isKilled()) {
    log.warn("Message rejected — kill switch active");
    return false;
  }
  return true;
}
