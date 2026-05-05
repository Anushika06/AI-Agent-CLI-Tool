/**
 * @fileoverview Entry point for the Website Cloner AI Agent CLI Tool.
 *
 * Wires together:
 *  - The Gemini generative AI client
 *  - The system prompt
 *  - The tool implementations
 *  - The agentic START → THINK → TOOL → OBSERVE → OUTPUT loop
 *  - A readline-based interactive CLI interface
 *
 * Usage:
 *   node index.js
 */

import "dotenv/config";
import readline from "readline";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_PROMPT } from "./prompt.js";
import { toolMap } from "./tools.js";

// ─── Validate environment ─────────────────────────────────────────────────────

if (!process.env.GEMINI_API_KEY) {
  console.error(
    "\n❌  GEMINI_API_KEY is not set. Please add it to your .env file.\n"
  );
  process.exit(1);
}

// ─── Gemini client setup ─────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * The Gemini model instance used for all agent completions.
 * Using gemini-1.5-flash for speed and large context window.
 */
const model = genAI.getGenerativeModel({
  model: "gemini-3.1-flash-lite-preview",
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 8192,
  },
});

// ─── JSON parsing helper ─────────────────────────────────────────────────────

/**
 * Safely parses the agent's JSON response, stripping any markdown code fences
 * that Gemini sometimes wraps around its output.
 *
 * @param {string} raw - The raw text response from Gemini.
 * @returns {{ step: string, content: string, tool_name?: string, tool_args?: object } | null}
 *   Parsed step object, or null if parsing fails.
 */
function parseAgentResponse(raw) {
  try {
    // Strip ```json ... ``` or ``` ... ``` fences
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    return JSON.parse(cleaned);
  } catch {
    // Attempt to extract the first JSON object from the string
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ─── Step display helpers ────────────────────────────────────────────────────

/** ANSI color codes for terminal output */
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  white: "\x1b[37m",
};

/**
 * Prints a formatted step line to the terminal.
 *
 * @param {string} step    - The current agent step (THINK, TOOL, etc.).
 * @param {string} content - The content/message to display.
 * @param {string} [extra] - Optional extra info (e.g. tool name).
 */
function printStep(step, content, extra = "") {
  const labels = {
    START: `${C.cyan}${C.bold}[START]${C.reset}`,
    THINK: `${C.yellow}${C.bold}[THINKING]${C.reset}`,
    TOOL: `${C.magenta}${C.bold}[TOOL CALL]${C.reset}`,
    OBSERVE: `${C.blue}${C.bold}[OBSERVING]${C.reset}`,
    OUTPUT: `${C.green}${C.bold}[OUTPUT]${C.reset}`,
  };

  const label = labels[step] || `${C.white}[${step}]${C.reset}`;
  const extraStr = extra ? ` ${C.dim}→ ${extra}${C.reset}` : "";
  console.log(`\n${label}${extraStr}`);

  // Truncate very long content for readability (tool output can be huge)
  const safeContent = content || "";
  const display =
    safeContent.length > 600 ? safeContent.slice(0, 600) + "  …(truncated)" : safeContent;
  console.log(`${C.dim}${display}${C.reset}`);
}

// ─── Agent loop ──────────────────────────────────────────────────────────────

/**
 * Runs the agentic loop for a single user message.
 * Maintains a conversation history formatted for the Gemini API
 * (alternating user / model roles).
 *
 * The loop:
 *  1. Appends the user message (or tool observation) as a "user" role turn.
 *  2. Calls Gemini's generateContent with the full history.
 *  3. Parses the JSON step response.
 *  4. If step === TOOL  → executes the tool, injects an OBSERVE turn, continues.
 *  5. If step === OUTPUT → prints the final message and breaks.
 *
 * @param {string} userMessage - The raw instruction from the CLI user.
 * @returns {Promise<void>}
 */
async function runAgentLoop(userMessage) {
  /**
   * Gemini conversation history.
   * The system prompt is baked into the first user turn because Gemini 1.5
   * does not support a standalone "system" role in generateContent.
   * @type {Array<{ role: "user"|"model", parts: [{ text: string }] }>}
   */
  const messages = [
    {
      role: "user",
      parts: [
        {
          text:
            `SYSTEM INSTRUCTIONS (follow these at all times):\n${SYSTEM_PROMPT}\n\n` +
            `USER REQUEST: ${userMessage}`,
        },
      ],
    },
  ];

  let iteration = 0;
  const MAX_ITERATIONS = 30; // Safety cap to prevent infinite loops

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    // ── Call Gemini ─────────────────────────────────────────────────────────
    let rawText;
    let retries = 0;
    const MAX_RETRIES = 3;

    while (retries <= MAX_RETRIES) {
      try {
        const result = await model.generateContent({ contents: messages });
        rawText = result.response.text();
        break; // Success
      } catch (apiErr) {
        const isRateLimit = apiErr.status === 429 || apiErr.message?.includes("429") || apiErr.message?.includes("Quota");
        
        if (isRateLimit && retries < MAX_RETRIES) {
          retries++;
          const delayMs = 15000 * retries; // Wait 15s, 30s, 45s
          console.warn(`\n${C.yellow}⚠️  Rate limit hit (429). Retrying in ${(delayMs / 1000).toFixed(0)}s (Attempt ${retries}/${MAX_RETRIES})...${C.reset}`);
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }

        console.error(`\n${C.red}❌  Gemini API error: ${apiErr.message}${C.reset}`);
        return; // Exit the loop entirely
      }
    }

    // ── Parse the JSON step ─────────────────────────────────────────────────
    const parsed = parseAgentResponse(rawText);

    if (!parsed || !parsed.step) {
      console.error(
        `\n${C.red}❌  Could not parse agent response (iteration ${iteration}).${C.reset}`
      );
      console.error(`${C.dim}Raw response:\n${rawText.slice(0, 400)}${C.reset}`);

      // Push a corrective message and retry once
      messages.push({ role: "model", parts: [{ text: rawText }] });
      messages.push({
        role: "user",
        parts: [
          {
            text:
              "Your last response was not valid JSON. " +
              "You MUST respond with a single JSON object matching the schema: " +
              '{ "step": "THINK|TOOL|OBSERVE|OUTPUT", "content": "..." }. ' +
              "Try again.",
          },
        ],
      });
      continue;
    }

    const { step, content, tool_name, tool_args } = parsed;

    // ── Display the step ────────────────────────────────────────────────────
    printStep(step, content, tool_name || "");

    // ── Append assistant message to history ─────────────────────────────────
    messages.push({ role: "model", parts: [{ text: rawText }] });

    // ── Handle step types ───────────────────────────────────────────────────

    if (step === "OUTPUT") {
      // Final response — we're done
      console.log(
        `\n${C.green}${C.bold}✅  Agent completed the task.${C.reset}\n`
      );
      break;
    }

    if (step === "TOOL") {
      if (!tool_name || !toolMap[tool_name]) {
        const errMsg = `Unknown tool: "${tool_name}". Available: ${Object.keys(toolMap).join(", ")}`;
        console.error(`\n${C.red}⚠️   ${errMsg}${C.reset}`);
        messages.push({
          role: "user",
          parts: [
            {
              text: JSON.stringify({ step: "OBSERVE", content: errMsg }),
            },
          ],
        });
        continue;
      }

      // Execute the tool
      console.log(
        `\n${C.magenta}  ⚙️   Executing: ${tool_name}(${JSON.stringify(tool_args || {})})${C.reset}`
      );

      let toolResult;
      try {
        toolResult = await toolMap[tool_name](tool_args || {});
      } catch (toolErr) {
        toolResult = `Tool execution error: ${toolErr.message}`;
      }

      // Inject the OBSERVE turn as a "user" role message (Gemini requirement)
      const observePayload = JSON.stringify({
        step: "OBSERVE",
        content: toolResult,
      });

      messages.push({
        role: "user",
        parts: [{ text: observePayload }],
      });

      printStep("OBSERVE", toolResult);
      continue;
    }

    // For START / THINK / OBSERVE steps: just push a user prompt to continue
    messages.push({
      role: "user",
      parts: [{ text: "Continue to the next step." }],
    });
  }

  if (iteration >= MAX_ITERATIONS) {
    console.warn(
      `\n${C.yellow}⚠️   Reached maximum iterations (${MAX_ITERATIONS}). Stopping.${C.reset}\n`
    );
  }
}

// ─── CLI Interface ───────────────────────────────────────────────────────────

/**
 * Initializes the readline-based interactive CLI and starts the input loop.
 * Reads user input, passes it to the agent loop, and waits for the next prompt.
 *
 * @returns {void}
 */
function startCLI() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Welcome banner
  console.log(`
${C.cyan}${C.bold}╔══════════════════════════════════════════════════════════════╗
║          🌐  Website Cloner Agent  —  Powered by Gemini       ║
╚══════════════════════════════════════════════════════════════╝${C.reset}

${C.dim}Type a URL or instruction to begin. Examples:
  • https://www.scaler.com/
  • clone https://www.stripe.com/
  • exit  (to quit)${C.reset}
`);

  /**
   * Prompts the user for input and processes it through the agent loop.
   */
  function prompt() {
    rl.question(`${C.cyan}${C.bold}You ▶${C.reset}  `, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        console.log(`\n${C.dim}Goodbye! 👋${C.reset}\n`);
        rl.close();
        process.exit(0);
      }

      try {
        await runAgentLoop(trimmed);
      } catch (err) {
        console.error(`\n${C.red}Unexpected error: ${err.message}${C.reset}\n`);
      }

      // Ready for the next instruction
      prompt();
    });
  }

  prompt();
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
startCLI();
