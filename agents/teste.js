/**
 * ============================================================================
 * GitHub Models — GPT-5-Mini Agent Loop (Node.js)
 * ============================================================================
 * Requirements:
 *   npm install openai
 *
 * Environment:
 *   export GITHUB_TOKEN=gho_xxxxxxxxxxxxxxxxx
 *
 * This implementation is:
 *   - Safe (no eval)
 *   - Deterministic
 *   - Agent-ready (tool dispatch)
 *   - Optimized for reasoning models (gpt-5-mini)
 * ============================================================================
 */

const OpenAI = require("openai");

/* ---------------------------------------------------------------------------
 * Client configuration — GitHub Models (OpenAI-compatible API)
 * ---------------------------------------------------------------------------
 */
const client = new OpenAI({
  baseURL: "https://models.github.ai/inference",
  apiKey: process.env.GITHUB_TOKEN,
  defaultQuery: {
    "api-version": "2024-08-01-preview",
  },
});

/* ---------------------------------------------------------------------------
 * Tool registry (EXPLICIT, SAFE, AUDITABLE)
 * ---------------------------------------------------------------------------
 */
const tools = {
  system_time: () => {
    return new Date().toISOString();
  },

  echo: ({ text }) => {
    return `Echo: ${text}`;
  },
};

/* ---------------------------------------------------------------------------
 * Initial conversation state
 * ---------------------------------------------------------------------------
 */
const messages = [
  {
    role: "system",
    content: [
      {
        type: "text",
        text: `
You are an analytical reasoning agent.
- Prefer explicit reasoning.
- Use tools only when necessary.
- If no tool is required, answer directly and conclude.
        `.trim(),
      },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "text",
        text: "Explique, em até 5 linhas, o que é GitHub Models.",
      },
    ],
  },
];

/* ---------------------------------------------------------------------------
 * Core agent loop
 * ---------------------------------------------------------------------------
 */
async function runAgent() {
  while (true) {
    const response = await client.chat.completions.create({
      model: "openai/gpt-5-mini",
      messages,
      max_completion_tokens: 32768,
      reasoning_effort: "high",
      tools: [
        {
          type: "function",
          function: {
            name: "system_time",
            description: "Returns the current system time in ISO format",
            parameters: { type: "object", properties: {} },
          },
        },
        {
          type: "function",
          function: {
            name: "echo",
            description: "Echoes back a provided text",
            parameters: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
              required: ["text"],
            },
          },
        },
      ],
    });

    const choice = response.choices[0];
    const message = choice.message;

    /* ---------------------------------------------------------------
     * Case 1 — Model requests tool execution
     * ---------------------------------------------------------------
     */
    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push(message);

      for (const call of message.tool_calls) {
        const toolName = call.function.name;
        const args = JSON.parse(call.function.arguments || "{}");

        if (!tools[toolName]) {
          throw new Error(`Unknown tool requested: ${toolName}`);
        }

        const result = await tools[toolName](args);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: [
            {
              type: "text",
              text: String(result),
            },
          ],
        });
      }

      continue;
    }

    /* ---------------------------------------------------------------
     * Case 2 — Final model answer
     * ---------------------------------------------------------------
     */
    if (message.content) {
      console.log("\n[MODEL OUTPUT]\n");
      console.log(message.content.map(c => c.text).join("\n"));
      break;
    }

    throw new Error("Unexpected model response structure");
  }
}

/* ---------------------------------------------------------------------------
 * Entrypoint
 * ---------------------------------------------------------------------------
 */
runAgent().catch(err => {
  console.error("Agent failure:", err);
  process.exit(1);
});
