/**
 * Policy engine — runtime enforcement for managed OpenClaw agents.
 *
 * Deny-by-default: anything not explicitly allowed is blocked.
 * Fail-closed: if policy can't be evaluated, deny the action.
 */

import fs from "node:fs";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { auditLog } from "./audit.js";
import type { ActionCategory, PolicyDecision, PolicyDefinition, PolicyState } from "./types.js";

const log = createSubsystemLogger("policy");

/** Singleton policy state. Null = not loaded (fail closed). */
let currentPolicy: PolicyState | null = null;

/** Whether the agent has been killed (volatile runtime flag). */
let killedFlag = false;

/**
 * Normalize a name for case-insensitive comparison.
 */
function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Build a PolicyState from a PolicyDefinition.
 */
export function buildPolicyState(def: PolicyDefinition): PolicyState {
  return {
    definition: def,
    allowedSkills: new Set(def.skills.allow.map(normalize)),
    allowedTools: new Set(def.tools.allow.map(normalize)),
    allowedActions: new Set(def.actions?.allow ?? []),
  };
}

/**
 * Create a permissive policy for BYOO (unmanaged) mode.
 */
export function createPermissivePolicy(): PolicyDefinition {
  return {
    version: 1,
    managed: false,
    skills: { allow: [] },
    tools: { allow: [] },
  };
}

/**
 * Load policy from a YAML file path.
 * Falls back to fail-closed if loading fails.
 */
export async function loadPolicyFromFile(filePath: string): Promise<PolicyState> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    // Simple YAML parser for our flat schema — avoids adding a dependency.
    // For production, consider using js-yaml.
    const def = parsePolicyYaml(raw);
    const state = buildPolicyState(def);
    currentPolicy = state;
    log.info(`Policy loaded from ${filePath} (managed=${def.managed})`);
    await auditLog(state, {
      timestamp: new Date().toISOString(),
      event: "policy_load",
      decision: "allow",
      target: filePath,
    });
    return state;
  } catch (err) {
    log.error(`Failed to load policy from ${filePath}: ${String(err)}`);
    throw new Error(`Policy load failed: ${String(err)}`, { cause: err });
  }
}

/**
 * Set the active policy directly (for programmatic use / tests).
 */
export function setPolicy(def: PolicyDefinition): PolicyState {
  const state = buildPolicyState(def);
  currentPolicy = state;
  return state;
}

/**
 * Get the current policy state. Returns null if no policy loaded.
 */
export function getPolicy(): PolicyState | null {
  return currentPolicy;
}

/**
 * Clear the active policy (for tests).
 */
export function clearPolicy(): void {
  currentPolicy = null;
  killedFlag = false;
}

/**
 * Check if agent is in managed mode.
 */
export function isManaged(): boolean {
  return currentPolicy?.definition.managed === true;
}

/**
 * Check if agent has been killed.
 */
export function isKilled(): boolean {
  return killedFlag || currentPolicy?.definition.killed === true;
}

/**
 * Activate the kill switch.
 */
export function activateKillSwitch(): void {
  killedFlag = true;
  log.warn("Kill switch activated — agent will stop accepting new messages");
  if (currentPolicy) {
    void auditLog(currentPolicy, {
      timestamp: new Date().toISOString(),
      event: "kill_switch",
      decision: "deny",
      target: "agent",
      meta: { reason: "Kill switch activated" },
    });
  }
}

/**
 * Deactivate the kill switch.
 */
export function deactivateKillSwitch(): void {
  killedFlag = false;
  log.info("Kill switch deactivated");
}

// ── Enforcement functions ──────────────────────────────────────────

/**
 * Check if a skill is allowed to load.
 * Deny-by-default in managed mode. Permissive in BYOO mode.
 */
export function checkSkillAllowed(skillName: string): PolicyDecision {
  // Fail closed: no policy loaded → deny
  if (!currentPolicy) {
    return { allowed: false, reason: "No policy loaded (fail closed)" };
  }

  // BYOO mode: permissive
  if (!currentPolicy.definition.managed) {
    return { allowed: true, reason: "Unmanaged mode (permissive)" };
  }

  // Kill switch
  if (isKilled()) {
    return { allowed: false, reason: "Agent killed" };
  }

  const normalized = normalize(skillName);
  if (currentPolicy.allowedSkills.has(normalized)) {
    return { allowed: true, reason: "Skill on allowlist" };
  }

  return { allowed: false, reason: `Skill "${skillName}" not on allowlist` };
}

/**
 * Check if a tool call is allowed.
 * Deny-by-default in managed mode. Permissive in BYOO mode.
 */
export function checkToolAllowed(toolName: string): PolicyDecision {
  if (!currentPolicy) {
    return { allowed: false, reason: "No policy loaded (fail closed)" };
  }

  if (!currentPolicy.definition.managed) {
    return { allowed: true, reason: "Unmanaged mode (permissive)" };
  }

  if (isKilled()) {
    return { allowed: false, reason: "Agent killed" };
  }

  const normalized = normalize(toolName);
  if (currentPolicy.allowedTools.has(normalized)) {
    return { allowed: true, reason: "Tool on allowlist" };
  }

  return { allowed: false, reason: `Tool "${toolName}" not on allowlist` };
}

/**
 * Check if an action category is allowed.
 * Deny-by-default in managed mode. Permissive in BYOO mode.
 */
export function checkActionAllowed(action: ActionCategory): PolicyDecision {
  if (!currentPolicy) {
    return { allowed: false, reason: "No policy loaded (fail closed)" };
  }

  if (!currentPolicy.definition.managed) {
    return { allowed: true, reason: "Unmanaged mode (permissive)" };
  }

  if (isKilled()) {
    return { allowed: false, reason: "Agent killed" };
  }

  if (currentPolicy.allowedActions.has(action)) {
    return { allowed: true, reason: `Action "${action}" on allowlist` };
  }

  return { allowed: false, reason: `Action "${action}" not on allowlist` };
}

// ── YAML parsing ───────────────────────────────────────────────────

/**
 * Minimal YAML parser for our policy schema.
 * Handles the flat structure we need without a full YAML dependency.
 */
export function parsePolicyYaml(raw: string): PolicyDefinition {
  // Use JSON parse if the input is JSON (for flexibility)
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return validatePolicyDefinition(JSON.parse(trimmed));
  }

  // Simple line-based YAML parser for our known schema
  const lines = raw.split("\n");
  const result: Record<string, unknown> = {};
  let currentSection: string | null = null;
  let currentSubSection: string | null = null;

  for (const line of lines) {
    const stripped = line.replace(/#.*$/, "").trimEnd();
    if (!stripped.trim()) {
      continue;
    }

    const indent = stripped.length - stripped.trimStart().length;
    const content = stripped.trim();

    if (indent === 0 && content.endsWith(":")) {
      currentSection = content.slice(0, -1);
      currentSubSection = null;
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
    } else if (indent === 0 && content.includes(":")) {
      const [key, ...valueParts] = content.split(":");
      const value = valueParts.join(":").trim();
      result[key.trim()] = parseYamlValue(value);
    } else if (indent === 2 && currentSection && content.endsWith(":")) {
      currentSubSection = content.slice(0, -1);
      const section = result[currentSection] as Record<string, unknown>;
      if (!section[currentSubSection]) {
        section[currentSubSection] = {};
      }
    } else if (indent === 2 && currentSection && content.includes(":")) {
      const [key, ...valueParts] = content.split(":");
      const value = valueParts.join(":").trim();
      (result[currentSection] as Record<string, unknown>)[key.trim()] = parseYamlValue(value);
    } else if (indent >= 4 && currentSection && currentSubSection && content.startsWith("- ")) {
      const section = result[currentSection] as Record<string, unknown>;
      const sub = section[currentSubSection] as Record<string, unknown> | unknown[];
      const item = content.slice(2).trim();
      if (Array.isArray(sub)) {
        sub.push(parseYamlValue(item));
      } else {
        section[currentSubSection] = [parseYamlValue(item)];
      }
    } else if (indent === 4 && currentSection && currentSubSection && content.includes(":")) {
      const [key, ...valueParts] = content.split(":");
      const value = valueParts.join(":").trim();
      const section = result[currentSection] as Record<string, unknown>;
      (section[currentSubSection] as Record<string, unknown>)[key.trim()] = parseYamlValue(value);
    }
  }

  return validatePolicyDefinition(result);
}

function parseYamlValue(value: string): unknown {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null" || value === "") {
    return null;
  }
  const num = Number(value);
  if (!isNaN(num) && value !== "") {
    return num;
  }
  // Strip quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function validatePolicyDefinition(raw: unknown): PolicyDefinition {
  const obj = raw as Record<string, unknown>;

  const version = (obj.version as number) ?? 1;
  if (version !== 1) {
    throw new Error(`Unsupported policy version: ${version}`);
  }

  const managed = obj.managed === true;

  const skills = obj.skills as Record<string, unknown> | undefined;
  const skillAllow = Array.isArray(skills?.allow) ? (skills.allow as string[]).map(String) : [];

  const tools = obj.tools as Record<string, unknown> | undefined;
  const toolAllow = Array.isArray(tools?.allow) ? (tools.allow as string[]).map(String) : [];

  const actions = obj.actions as Record<string, unknown> | undefined;
  const actionAllow = Array.isArray(actions?.allow)
    ? (actions.allow as ActionCategory[])
    : undefined;

  const audit = obj.audit as Record<string, unknown> | undefined;

  return {
    version: 1,
    managed,
    killed: obj.killed === true,
    skills: { allow: skillAllow },
    tools: { allow: toolAllow },
    actions: actionAllow ? { allow: actionAllow } : undefined,
    audit: audit
      ? {
          logFile: audit.logFile as string | undefined,
          webhookUrl: audit.webhookUrl as string | undefined,
          includeArgs: audit.includeArgs === true,
        }
      : undefined,
  };
}
