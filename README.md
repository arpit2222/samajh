# Samajh — "Learn it. Prove it."

AI-powered understanding verification for NISM certification candidates, retail F&O traders, employers, and developer/agent integrations.

## Stack
- **Frontend:** Next.js 15 (App Router) + Tailwind CSS + shared UI primitives (`Button`, `Card`, `Input`, `Spinner`, `ErrorBanner`, `ProgressStepper`) + Firebase Auth
- **Backend:** Node.js / Express + Google ADK (`@google/adk` 5-agent `SequentialAgent` + `BuiltInCodeExecutor`) + Gemini REST API + Vertex AI Search / NISM Workbook RAG
- **Database:** Google Cloud Firestore (MongoDB-compatible mode via `MONGO_CONNECTION_STRING`, with Native Firestore fallback)
- **Credentials:** Server-side HMAC-SHA256 verifiable credentials (`/verify/:credentialId`) + optional additive Polygon Amoy Soulbound Token anchor

## Developer Platform (Public REST API v1 + MCP Server)

Authenticated users can create and revoke API keys (`sk_live_...`) at **`/developer`**:
- Keys are generated with `crypto.randomBytes(32)` (base64url), prefixed with `sk_live_`, and stored **only as SHA-256 hashes** (`keyHash`) + a 12-character `keyPrefix` in Firestore `api_keys`. The plaintext key is shown once at creation time and never stored or logged.
- Every Public REST v1 route and every MCP tool shares the exact same `authenticateApiKey` middleware and the exact same single internal capability function (`backend/src/services/capabilities.js`).

### Public REST API v1 (`/api/public/v1/`)
Authenticate every request with `Authorization: Bearer sk_live_...`:
- `POST /api/public/v1/verify-understanding` — `{ concept, explanation }`
- `GET /api/public/v1/verify-credential/:credentialId`
- `POST /api/public/v1/diagnose-trade-patterns` — strictly anonymized `{ ratios, risk_tags, trade, note? }` (rejects PII & ₹ amounts server-side)

### MCP Server (`/mcp` — Streamable HTTP)
Mounted inside the same Express backend process at **`/mcp`** using `@modelcontextprotocol/sdk` (`StreamableHTTPServerTransport`).

- **Authentication method used:** `Authorization: Bearer <sk_live_...>` HTTP header, validated through the exact same `authenticateApiKey` middleware as `/api/public/v1/*`.
- **Exposed tools:**
  1. `verify_understanding` (`{ concept, explanation }`)
  2. `verify_credential` (`{ credentialId }`)
  3. `diagnose_trade_patterns` (`{ ratios?, risk_tags?, trade, note? }`)

Example MCP client config:
```json
{
  "mcpServers": {
    "samajh": {
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer sk_live_YOUR_API_KEY"
      }
    }
  }
}
```

## Local Development
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Fill in GEMINI_API_KEY, CREDENTIAL_SIGNING_KEY, MONGO_CONNECTION_STRING, and Firebase Web config

npm run dev --prefix backend   # http://localhost:8080
npm run dev --prefix frontend  # http://localhost:3000
```
