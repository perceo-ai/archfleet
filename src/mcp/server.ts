#!/usr/bin/env -S npx tsx
// Fleet MCP server (stdio). Exposes every fleet operation — workflows, runs,
// triggers, secrets, VMs — as MCP tools so an agent can drive the whole system.
//
//   npm run mcp
// or register in an MCP client with command `npx tsx src/mcp/server.ts` and env
// (CUF_DB_PATH, CUF_SECRET_KEY, CUF_GOLDEN_DOMAIN, CUF_SSH_KEY, OPENROUTER_API_KEY,
//  CUF_GROUNDING_BASE_URL).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDb } from "../lib/fleet/db/db";
import { ensureSeeded } from "../lib/fleet/db/init-db";
import { FLEET_TOOLS } from "./tools";

async function main() {
  const db = getDb();
  try {
    ensureSeeded(db);
  } catch {
    // non-fatal
  }

  const server = new McpServer({ name: "archfleet", version: "0.1.0" });

  for (const tool of FLEET_TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.shape },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.run(db, args ?? {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return {
            content: [{ type: "text", text: `Error: ${String(e)}` }],
            isError: true,
          };
        }
      },
    );
  }

  await server.connect(new StdioServerTransport());
  // stdio transport keeps the process alive.
}

main().catch((e) => {
  console.error("archfleet MCP failed:", e);
  process.exit(1);
});
