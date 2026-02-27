/**
 * Policy engine types for EV managed OpenClaw runtime.
 *
 * Defines the schema for YAML-based policy definitions per customer tier,
 * skill/tool allowlists, action gates, and audit logging.
 */

/** Action categories that can be gated by policy. */
export type ActionCategory =
  | "email"
  | "sms"
  | "api_call"
  | "file_write"
  | "file_delete"
  | "exec"
  | "browser"
  | "message_send"
  | "webhook";

/** Policy definition for a customer tier. */
export type PolicyDefinition = {
  /** Schema version for forward compat. */
  version: 1;

  /** Whether managed mode is active. When false, all checks are permissive. */
  managed: boolean;

  /** Kill switch — when true, agent rejects all new messages. */
  killed?: boolean;

  /** Skill allowlist. Only these skill names can load. Empty = none allowed. */
  skills: {
    allow: string[];
  };

  /** Tool allowlist. Only these tool names can be dispatched. Empty = none allowed. */
  tools: {
    allow: string[];
  };

  /** Action gates. Actions not listed here default to denied. */
  actions?: {
    allow?: ActionCategory[];
  };

  /** Audit configuration. */
  audit?: {
    /** Path to structured JSON log file. */
    logFile?: string;
    /** Webhook URL for real-time audit events. */
    webhookUrl?: string;
    /** Whether to include tool arguments in audit logs (may contain sensitive data). */
    includeArgs?: boolean;
  };
};

/** Runtime policy state — the loaded+validated policy with helper context. */
export type PolicyState = {
  definition: PolicyDefinition;
  /** Pre-computed sets for O(1) lookups. */
  allowedSkills: Set<string>;
  allowedTools: Set<string>;
  allowedActions: Set<ActionCategory>;
};

/** Audit log entry for a policy decision. */
export type AuditEntry = {
  timestamp: string;
  event: "tool_call" | "skill_load" | "action_gate" | "kill_switch" | "policy_load";
  decision: "allow" | "deny";
  /** Tool or skill name. */
  target: string;
  /** Sanitized arguments (when includeArgs is true). */
  args?: Record<string, unknown>;
  /** Result summary. */
  result?: string;
  /** Additional context. */
  meta?: Record<string, unknown>;
};

/** Policy decision result. */
export type PolicyDecision = {
  allowed: boolean;
  reason: string;
};
