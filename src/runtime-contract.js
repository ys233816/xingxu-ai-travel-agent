export const MAX_TOOL_CALLS = 16;
export const MAX_TOOL_CALLS_CEILING = 32;
export const MAX_ATTEMPTS_PER_TOOL = 2;
export const MAX_RETRIES_PER_TOOL = MAX_ATTEMPTS_PER_TOOL - 1;
export const MAX_MODEL_ROUNDS = 8;

export function resolveToolCallBudget(days) {
  const boundedDays = Math.min(30, Math.max(1, Number(days) || 1));
  return Math.min(
    MAX_TOOL_CALLS_CEILING,
    Math.max(MAX_TOOL_CALLS, MAX_TOOL_CALLS + Math.max(0, boundedDays - 3) * 2)
  );
}

export const RUNTIME_LIMITS = Object.freeze({
  maxToolCalls: MAX_TOOL_CALLS,
  maxToolCallsCeiling: MAX_TOOL_CALLS_CEILING,
  maxAttemptsPerTool: MAX_ATTEMPTS_PER_TOOL,
  maxRetriesPerTool: MAX_RETRIES_PER_TOOL,
  maxModelRounds: MAX_MODEL_ROUNDS,
});
