import { Router } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { authenticateApiKey } from "../middleware/apiKeyAuth.js";
import {
  verifyUnderstandingCapability,
  verifyCredentialCapability,
  diagnoseTradePatternsCapability,
} from "../services/capabilities.js";

const router = Router();

/**
 * Explicit JSON-schema definitions for the 3 Samajh MCP tools.
 * Each handler delegates directly to the exact same internal capability function
 * used by /api/public/v1/* — zero duplicated logic.
 */
const MCP_TOOLS = [
  {
    name: "verify_understanding",
    description:
      "Grade a learner's causal explanation of a financial/NISM concept using Samajh's ExaminerAgent (with NISM RAG grounding and ADK Python Code Execution math).",
    inputSchema: {
      type: "object",
      properties: {
        concept: {
          type: "string",
          description: "The financial or NISM concept being tested.",
        },
        explanation: {
          type: "string",
          description: "The learner's explanation of the concept in their own words.",
        },
      },
      required: ["concept", "explanation"],
    },
  },
  {
    name: "verify_credential",
    description:
      "Independently verify a Samajh public credential by credentialId, recomputing its HMAC-SHA256 signature and returning verified status + public concept scores.",
    inputSchema: {
      type: "object",
      properties: {
        credentialId: {
          type: "string",
          description: "Public credential slug (e.g. 'smj-a1b2c3d4').",
        },
      },
      required: ["credentialId"],
    },
  },
  {
    name: "diagnose_trade_patterns",
    description:
      "Diagnose structural risk-literacy mistake patterns from strictly anonymized trade buckets and behavioral ratios (rejects any PII or ₹ amounts; never gives investment advice).",
    inputSchema: {
      type: "object",
      properties: {
        ratios: {
          type: "object",
          properties: {
            fno_pct: { type: "number" },
            overnight_pct: { type: "number" },
            expiry_day_pct: { type: "number" },
            total_trades: { type: "number" },
          },
        },
        risk_tags: {
          type: "array",
          items: { type: "string" },
        },
        trade: {
          type: "object",
          properties: {
            date: { type: "string" },
            instrument_type: { type: "string" },
            segment: { type: "string" },
            direction: { type: "string", enum: ["BUY", "SELL"] },
            holding_bucket: { type: "string" },
            outcome_bucket: { type: "string", enum: ["loss", "gain", "flat"] },
            expiry_day: { type: "boolean" },
            had_stop_loss: { type: ["boolean", "null"] },
          },
          required: ["instrument_type"],
        },
        note: {
          type: "string",
          description: "Optional trader context note (must contain no PAN or ₹ amounts).",
        },
      },
      required: ["trade"],
    },
  },
];

function createSamajhMcpServer() {
  const server = new Server(
    {
      name: "samajh-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      let result;
      if (name === "verify_understanding") {
        result = await verifyUnderstandingCapability(args);
      } else if (name === "verify_credential") {
        result = await verifyCredentialCapability(args.credentialId);
      } else if (name === "diagnose_trade_patterns") {
        result = await diagnoseTradePatternsCapability(args);
      } else {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const status = err.statusCode || err.status || 500;
      const safeError = status >= 400 && status < 500 ? err.message : "internal_error";
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: safeError }) }],
      };
    }
  });

  return server;
}

/**
 * Mount Streamable HTTP MCP server at /mcp inside the same Express backend process.
 * Authenticated with the EXACT same authenticateApiKey middleware (Authorization: Bearer <key>).
 */
router.all("/", authenticateApiKey, async (req, res) => {
  const server = createSamajhMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless Streamable HTTP per request
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[Samajh MCP Error]", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "internal_error" });
    }
  }
});

export default router;
