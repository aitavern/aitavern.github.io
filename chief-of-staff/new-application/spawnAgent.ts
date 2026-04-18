// Spawn a claude -p agent with a prompt template and parse JSON output

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { spawn } from "child_process";

const AGENTS_DIR = join(dirname(import.meta.path), "agents");

/**
 * Load a prompt template and substitute variables.
 * Templates use {{VAR_NAME}} placeholders.
 */
export function buildPrompt(
  templateName: string,
  vars: Record<string, string>
): string {
  const templatePath = join(AGENTS_DIR, `${templateName}.md`);
  const template = readFileSync(templatePath, "utf-8");

  // Single-pass replacement to prevent double-substitution attacks.
  // If SYSTEM_DESCRIPTION contains "{{LEVERAGE_MAP}}", iterative replaceAll
  // would substitute it on a later pass. Regex single-pass avoids this.
  const missing: string[] = [];
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in vars) return vars[key];
    missing.push(key);
    return match;
  });

  // Guard against typos: an unreplaced placeholder would leak template syntax
  // into the agent's prompt and likely corrupt its output. Fail loudly instead.
  if (missing.length > 0) {
    const unique = Array.from(new Set(missing));
    throw new Error(
      `Template ${templateName} has unreplaced placeholders: ${unique.join(", ")}`
    );
  }

  return rendered;
}

/**
 * Spawn a claude agent and extract JSON from its output.
 * Looks for a JSON block in the output (between ```json and ```).
 */
export async function spawnAgent<T>(
  templateName: string,
  vars: Record<string, string>,
  options: {
    addDir?: string;
    timeout?: number;
  } = {}
): Promise<T> {
  const prompt = buildPrompt(templateName, vars);

  // The agents here only need to read files in the cloned repo and run git
  // commands for history analysis. Explicitly deny tools that could exfiltrate
  // data, spawn sub-agents, or write outside the sandbox. The clone itself has
  // already had dangerous config files stripped (see cloneRepo.ts), but
  // tool-level denials are the second layer of defense.
  const DISALLOWED_TOOLS = [
    "WebFetch",
    "WebSearch",
    "Task",
    "Agent",
    "NotebookEdit",
    "Write",
    "Edit",
  ].join(",");

  const args = [
    "-p",
    prompt,
    "--output-format",
    "text",
    "--no-session-persistence",
    "--disallowedTools",
    DISALLOWED_TOOLS,
  ];

  if (options.addDir) {
    args.push("--add-dir", options.addDir);
  }

  const timeout = options.timeout ?? 300_000; // 5 min default

  console.log(`Spawning ${templateName} agent...`);

  const output = await new Promise<string>((resolve, reject) => {
    const proc = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Agent ${templateName} timed out after ${timeout}ms`));
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(
          `Agent ${templateName} failed with exit code ${code}: ${(stderr || stdout).slice(-500)}`
        ));
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn agent ${templateName}: ${err.message}`));
    });
  });

  // Extract JSON from output — look for ```json ... ``` block first, then raw JSON
  const jsonBlockMatch = output.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (jsonBlockMatch) {
    return JSON.parse(jsonBlockMatch[1]) as T;
  }

  // Try to find a raw JSON object in the output
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]) as T;
  }

  throw new Error(
    `Agent ${templateName} did not produce valid JSON. Output tail: ${output.slice(-1000)}`
  );
}
