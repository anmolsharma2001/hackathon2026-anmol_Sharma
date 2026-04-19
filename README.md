# ShopWave Autonomous Support Agent
Agentic AI Hackathon 2026

## Quick Start
```
npm install
npm run dev
```

## Run without API (local mode)
```
npm run local
```

## Stack
TypeScript, Google Gemini 2.5 Flash, ReAct loop

## Structure
- src/agent/reactAgent.ts — ReAct loop + Gemini
- src/agent/localAgent.ts — local mode, no API
- src/tools/mockTools.ts — 8 tools with failure sim
- src/utils/retry.ts — backoff + dead-letter queue
- data/tickets.json — 20 official tickets
- logs/audit_log.json — generated after each run
