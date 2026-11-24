/**
 * Run one headless Claude Code agent (`claude -p`) and get its structured answer back.
 * Every agent starts fresh: it sees only the prompt it's given, never another agent's reasoning.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface AgentOptions {
  /** Built-in tools the agent may use. [] means none (a blind solver can't look anything up). */
  tools: string[];
  /** Extra permission patterns, e.g. "Bash(npx tsx scripts/real/unimorph.ts:*)". */
  allow?: string[];
  model?: "opus" | "sonnet" | "haiku";
  /** JSON Schema for the answer. Without it the agent's final text is returned. */
  schema?: object;
  cwd: string;
  /** Names the call (e.g. "2:fact") so relay mode never mistakes it for an earlier call with the same prompt. */
  key?: string;
}

export interface AgentResult<T> {
  answer: T;
  costUsd: number;
  turns: number;
}

export async function runAgent<T = string>(prompt: string, options: AgentOptions): Promise<AgentResult<T>> {
  if (process.env.NACLODLE_AGENT_RELAY) return relay<T>(prompt, options, process.env.NACLODLE_AGENT_RELAY);
  const argumentList = [
    "-p", prompt,
    "--output-format", "json",
    "--no-session-persistence",
    "--permission-mode", "acceptEdits",
    "--tools", options.tools.join(","),
  ];
  const allowed = [...options.tools, ...(options.allow ?? [])];
  if (allowed.length) argumentList.push("--allowedTools", ...allowed);
  if (options.model) argumentList.push("--model", options.model);
  if (options.schema) argumentList.push("--json-schema", JSON.stringify(options.schema));
  const { stdout, stderr, status } = await new Promise<{ stdout: string; stderr: string; status: number | null }>((resolve, reject) => {
    const child = spawn("claude", argumentList, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => reject(new Error(`Couldn't run claude: ${error.message}. Is Claude Code installed and on your PATH?`)));
    child.on("close", status => resolve({ stdout, stderr, status }));
  });
  let output: { result?: string; structured_output?: unknown; is_error?: boolean; total_cost_usd?: number; num_turns?: number };
  try {
    output = JSON.parse(stdout);
  } catch {
    throw new Error(`claude exited ${status} without JSON output: ${(stderr || stdout).slice(0, 500)}`);
  }
  if (output.is_error) throw new Error(`claude failed: ${String(output.result).slice(0, 500)}`);
  const answer = options.schema ? output.structured_output : output.result;
  if (options.schema && answer == null) throw new Error("claude returned no structured answer");
  return { answer: answer as T, costUsd: output.total_cost_usd ?? 0, turns: output.num_turns ?? 0 };
}

/**
 * Relay mode (NACLODLE_AGENT_RELAY=<dir>): instead of running `claude -p`, write <id>.request.json into the folder
 * and wait for someone (e.g. an interactive Claude session using its own subagents) to write <id>.response.json
 * holding the answer as JSON. For when headless Claude isn't available.
 */
async function relay<T>(prompt: string, options: AgentOptions, directory: string): Promise<AgentResult<T>> {
  mkdirSync(directory, { recursive: true });
  const id = createHash("sha256").update((options.key ?? "") + prompt + JSON.stringify(options.schema ?? null) + (options.model ?? "")).digest("hex").slice(0, 12);
  const requestPath = join(directory, `${id}.request.json`);
  const responsePath = join(directory, `${id}.response.json`);
  if (!existsSync(requestPath)) {
    writeFileSync(`${requestPath}.tmp`, JSON.stringify({ id, prompt, tools: options.tools, allow: options.allow ?? [], model: options.model ?? "opus", schema: options.schema ?? null }, null, 2));
    renameSync(`${requestPath}.tmp`, requestPath);
  }
  while (!existsSync(responsePath)) await new Promise(resolve => setTimeout(resolve, 2000));
  const text = readFileSync(responsePath, "utf8");
  const answer = options.schema ? JSON.parse(text) : text;
  return { answer: answer as T, costUsd: 0, turns: 0 };
}

/** Fill {{NAME}} placeholders. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in values ? values[name] : match));
}
