import { afterEach, describe, expect, it } from "vitest";
import { clearAuditBuffer, getAuditBuffer, sanitizeArgs } from "./audit.js";
import {
  activateKillSwitch,
  buildPolicyState,
  checkActionAllowed,
  checkSkillAllowed,
  checkToolAllowed,
  clearPolicy,
  createPermissivePolicy,
  deactivateKillSwitch,
  isKilled,
  isManaged,
  parsePolicyYaml,
  setPolicy,
} from "./engine.js";
import { createPolicySkillFilter, createPolicyToolFilter, shouldAcceptMessage } from "./hooks.js";
import type { PolicyDefinition } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function managedPolicy(overrides?: Partial<PolicyDefinition>): PolicyDefinition {
  return {
    version: 1,
    managed: true,
    skills: { allow: ["weather", "summarize"] },
    tools: { allow: ["web_search", "read", "tts"] },
    actions: { allow: ["api_call"] },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Policy Engine", () => {
  afterEach(() => {
    clearPolicy();
    clearAuditBuffer();
  });

  // ── Deny-by-default ──────────────────────────────────────────────

  describe("deny-by-default", () => {
    it("denies tool calls when no policy is loaded (fail closed)", () => {
      const result = checkToolAllowed("web_search");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("fail closed");
    });

    it("denies skill loads when no policy is loaded (fail closed)", () => {
      const result = checkSkillAllowed("weather");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("fail closed");
    });

    it("denies action when no policy is loaded (fail closed)", () => {
      const result = checkActionAllowed("email");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("fail closed");
    });
  });

  // ── Managed mode enforcement ─────────────────────────────────────

  describe("managed mode", () => {
    it("allows skills on the allowlist", () => {
      setPolicy(managedPolicy());
      expect(checkSkillAllowed("weather").allowed).toBe(true);
      expect(checkSkillAllowed("summarize").allowed).toBe(true);
    });

    it("blocks skills not on the allowlist", () => {
      setPolicy(managedPolicy());
      const result = checkSkillAllowed("coding-agent");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not on allowlist");
    });

    it("allows tools on the allowlist", () => {
      setPolicy(managedPolicy());
      expect(checkToolAllowed("web_search").allowed).toBe(true);
      expect(checkToolAllowed("read").allowed).toBe(true);
    });

    it("blocks tools not on the allowlist", () => {
      setPolicy(managedPolicy());
      const result = checkToolAllowed("exec");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not on allowlist");
    });

    it("allows actions on the allowlist", () => {
      setPolicy(managedPolicy());
      expect(checkActionAllowed("api_call").allowed).toBe(true);
    });

    it("blocks actions not on the allowlist", () => {
      setPolicy(managedPolicy());
      const result = checkActionAllowed("email");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not on allowlist");
    });

    it("is case-insensitive for skill names", () => {
      setPolicy(managedPolicy());
      expect(checkSkillAllowed("Weather").allowed).toBe(true);
      expect(checkSkillAllowed("WEATHER").allowed).toBe(true);
    });

    it("is case-insensitive for tool names", () => {
      setPolicy(managedPolicy());
      expect(checkToolAllowed("Web_Search").allowed).toBe(true);
    });

    it("reports managed mode correctly", () => {
      setPolicy(managedPolicy());
      expect(isManaged()).toBe(true);
    });
  });

  // ── BYOO (unmanaged) mode ────────────────────────────────────────

  describe("BYOO (unmanaged) mode", () => {
    it("allows all skills when managed=false", () => {
      setPolicy(createPermissivePolicy());
      expect(checkSkillAllowed("anything").allowed).toBe(true);
      expect(checkSkillAllowed("coding-agent").allowed).toBe(true);
    });

    it("allows all tools when managed=false", () => {
      setPolicy(createPermissivePolicy());
      expect(checkToolAllowed("exec").allowed).toBe(true);
      expect(checkToolAllowed("browser").allowed).toBe(true);
    });

    it("allows all actions when managed=false", () => {
      setPolicy(createPermissivePolicy());
      expect(checkActionAllowed("email").allowed).toBe(true);
    });

    it("reports unmanaged mode correctly", () => {
      setPolicy(createPermissivePolicy());
      expect(isManaged()).toBe(false);
    });
  });

  // ── Kill switch ──────────────────────────────────────────────────

  describe("kill switch", () => {
    it("blocks all tool calls when killed", () => {
      setPolicy(managedPolicy());
      activateKillSwitch();
      expect(isKilled()).toBe(true);
      expect(checkToolAllowed("web_search").allowed).toBe(false);
      expect(checkToolAllowed("web_search").reason).toContain("killed");
    });

    it("blocks all skill loads when killed", () => {
      setPolicy(managedPolicy());
      activateKillSwitch();
      expect(checkSkillAllowed("weather").allowed).toBe(false);
    });

    it("blocks message acceptance when killed", () => {
      setPolicy(managedPolicy());
      activateKillSwitch();
      expect(shouldAcceptMessage()).toBe(false);
    });

    it("can be deactivated", () => {
      setPolicy(managedPolicy());
      activateKillSwitch();
      expect(isKilled()).toBe(true);
      deactivateKillSwitch();
      expect(isKilled()).toBe(false);
      expect(checkToolAllowed("web_search").allowed).toBe(true);
    });

    it("respects killed flag in policy definition", () => {
      setPolicy(managedPolicy({ killed: true }));
      expect(isKilled()).toBe(true);
      expect(checkToolAllowed("web_search").allowed).toBe(false);
    });
  });

  // ── Audit logging ────────────────────────────────────────────────

  describe("audit logging", () => {
    it("logs tool call decisions to audit buffer", () => {
      setPolicy(managedPolicy());
      const filter = createPolicyToolFilter();
      filter("web_search");
      filter("exec");

      const entries = getAuditBuffer();
      // Filter to tool_call events (skip policy_load if any)
      const toolEntries = entries.filter((e) => e.event === "tool_call");
      expect(toolEntries).toHaveLength(2);
      expect(toolEntries[0].decision).toBe("allow");
      expect(toolEntries[0].target).toBe("web_search");
      expect(toolEntries[1].decision).toBe("deny");
      expect(toolEntries[1].target).toBe("exec");
    });

    it("logs skill load decisions to audit buffer", () => {
      setPolicy(managedPolicy());
      const filter = createPolicySkillFilter();
      filter("weather");
      filter("coding-agent");

      const entries = getAuditBuffer().filter((e) => e.event === "skill_load");
      expect(entries).toHaveLength(2);
      expect(entries[0].decision).toBe("allow");
      expect(entries[1].decision).toBe("deny");
    });

    it("sanitizes secret-looking arguments", () => {
      const sanitized = sanitizeArgs({
        query: "hello",
        apiKey: "sk-secret-123",
        password: "hunter2",
        normal: 42,
        longText: "a".repeat(600),
      });
      expect(sanitized.query).toBe("hello");
      expect(sanitized.apiKey).toBe("[REDACTED]");
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.normal).toBe(42);
      expect(sanitized.longText as string).toContain("[truncated]");
    });
  });

  // ── YAML parsing ─────────────────────────────────────────────────

  describe("YAML parsing", () => {
    it("parses a valid policy YAML", () => {
      const yaml = `
version: 1
managed: true
skills:
  allow:
    - weather
    - summarize
tools:
  allow:
    - web_search
    - read
actions:
  allow:
    - api_call
audit:
  logFile: /tmp/audit.jsonl
  includeArgs: false
`;
      const def = parsePolicyYaml(yaml);
      expect(def.version).toBe(1);
      expect(def.managed).toBe(true);
      expect(def.skills.allow).toEqual(["weather", "summarize"]);
      expect(def.tools.allow).toEqual(["web_search", "read"]);
      expect(def.actions?.allow).toEqual(["api_call"]);
      expect(def.audit?.logFile).toBe("/tmp/audit.jsonl");
      expect(def.audit?.includeArgs).toBe(false);
    });

    it("parses JSON input", () => {
      const json = JSON.stringify({
        version: 1,
        managed: true,
        skills: { allow: ["weather"] },
        tools: { allow: ["read"] },
      });
      const def = parsePolicyYaml(json);
      expect(def.managed).toBe(true);
      expect(def.skills.allow).toEqual(["weather"]);
    });

    it("defaults managed to false when not specified", () => {
      const yaml = `
version: 1
skills:
  allow:
    - weather
tools:
  allow:
    - read
`;
      const def = parsePolicyYaml(yaml);
      expect(def.managed).toBe(false);
    });
  });

  // ── buildPolicyState ─────────────────────────────────────────────

  describe("buildPolicyState", () => {
    it("creates pre-computed sets from definition", () => {
      const state = buildPolicyState(managedPolicy());
      expect(state.allowedSkills.has("weather")).toBe(true);
      expect(state.allowedSkills.has("summarize")).toBe(true);
      expect(state.allowedSkills.has("coding-agent")).toBe(false);
      expect(state.allowedTools.has("web_search")).toBe(true);
      expect(state.allowedTools.has("exec")).toBe(false);
      expect(state.allowedActions.has("api_call")).toBe(true);
      expect(state.allowedActions.has("email")).toBe(false);
    });
  });
});
