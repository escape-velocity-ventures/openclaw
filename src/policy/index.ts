/**
 * Policy engine public API.
 *
 * Usage:
 *   import { setPolicy, checkToolAllowed, checkSkillAllowed } from "./policy/index.js";
 */

export type {
  ActionCategory,
  AuditEntry,
  PolicyDecision,
  PolicyDefinition,
  PolicyState,
} from "./types.js";

export {
  activateKillSwitch,
  buildPolicyState,
  checkActionAllowed,
  checkSkillAllowed,
  checkToolAllowed,
  clearPolicy,
  createPermissivePolicy,
  deactivateKillSwitch,
  getPolicy,
  isKilled,
  isManaged,
  loadPolicyFromFile,
  parsePolicyYaml,
  setPolicy,
} from "./engine.js";

export { auditLog, clearAuditBuffer, getAuditBuffer, sanitizeArgs } from "./audit.js";

export { createPolicySkillFilter, createPolicyToolFilter } from "./hooks.js";
