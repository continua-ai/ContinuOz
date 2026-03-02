/**
 * Test: Warp API artifact retrieval
 *
 * Runs a real agent task that should produce an artifact, then polls the
 * task status endpoint and verifies that the `artifacts` array is present
 * and non-empty in the response.
 *
 * Usage:
 *   npx tsx tests/test-agent-artifacts.ts
 *
 * Env vars (reads from .env.local automatically via dotenv):
 *   WARP_API_KEY  – Warp API key or access token
 *   WARP_API_URL  – API base URL (defaults to https://app.warp.dev)
 */

import OzAPI from "oz-agent-sdk"
import type { RunItem } from "oz-agent-sdk/resources/agent/runs"
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env then .env.local (latter overrides)
dotenv.config({ path: path.resolve(__dirname, "../.env") })
dotenv.config({ path: path.resolve(__dirname, "../.env.local"), override: true })

// ── Config ──────────────────────────────────────────────────
const API_BASE = process.env.WARP_API_URL || "https://app.warp.dev"
const API_KEY = process.env.WARP_API_KEY
const ENVIRONMENT_ID = process.env.WARP_ENVIRONMENT_ID

const POLL_INTERVAL_MS = 5_000
const MAX_POLL_ATTEMPTS = 60 // 5 minutes
const ARTIFACT_RETRY_ATTEMPTS = 6

if (!API_KEY) {
  console.error("WARP_API_KEY is not set. Aborting.")
  process.exit(1)
}

if (!ENVIRONMENT_ID) {
  console.error("WARP_ENVIRONMENT_ID is not set. Aborting.")
  process.exit(1)
}

// ── Helpers ─────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function createClient() {
  const baseURL = process.env.WARP_API_URL
    ? `${process.env.WARP_API_URL.replace(/\/+$/, "")}/api/v1`
    : undefined

  return new OzAPI({
    apiKey: API_KEY,
    ...(baseURL ? { baseURL } : {}),
  })
}

type RunStatus = RunItem

async function waitForArtifacts(taskId: string, initial: RunStatus, client: OzAPI) {
  const initialArtifacts = Array.isArray(initial.artifacts) ? initial.artifacts : []
  if (initialArtifacts.length > 0) {
    return initial
  }

  for (let attempt = 0; attempt < ARTIFACT_RETRY_ATTEMPTS; attempt++) {
    await sleep(2000 * (attempt + 1))
    const status = await client.agent.runs.retrieve(taskId, {
      query: { include: "artifacts" },
    })
    const artifacts = Array.isArray(status.artifacts) ? status.artifacts : []
    if (artifacts.length > 0) {
      return status
    }
  }

  return initial
}

async function fetchLatestPlanRun(client: OzAPI) {
  const response = await client.agent.runs.list({
    artifact_type: "PLAN",
    limit: 1,
    ...(ENVIRONMENT_ID ? { environment_id: ENVIRONMENT_ID } : {}),
  })

  const run = response.runs?.[0]
  if (!run) return null

  const retrieved = await client.agent.runs.retrieve(run.run_id || run.task_id, {
    query: { include: "artifacts" },
  })

  return retrieved
}

// ── Test ────────────────────────────────────────────────────
async function main() {
  console.log("=== Warp API Artifact Retrieval Test ===\n")
  console.log(`API base : ${API_BASE}`)
  console.log(`Env ID   : ${ENVIRONMENT_ID}\n`)

  // 1. Run an agent with a prompt that should produce plan + PR artifacts
  const prompt = [
    "Do the following two things:",
    "1. Use the artifacts tool to create a PLAN artifact titled 'Health Check Plan' that outlines a brief implementation plan for adding a health-check endpoint to a Node.js Express server.",
    "2. If you create any other artifacts (like a pull request), include them as artifacts too.",
    "Make sure the plan is created via the artifacts tool so it appears in the artifacts list.",
  ].join("\n")

  console.log("1. Starting agent task (expects plan + PR artifacts)…")
  const client = createClient()
  const runRes = await client.agent.run({
    prompt,
    config: { environment_id: ENVIRONMENT_ID },
  })

  const taskId: string = runRes.run_id || runRes.task_id
  console.log(`   task_id: ${taskId}\n`)

  // 2. Poll until terminal state
  console.log("2. Polling for completion…")
  let finalResponse: RunStatus | null = null

  for (let i = 1; i <= MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS)

    const status = await client.agent.runs.retrieve(taskId, {
      query: { include: "artifacts" },
    })
    const state = (status.state as string)?.toUpperCase()
    console.log(`   [${i}/${MAX_POLL_ATTEMPTS}] state=${state}`)

    if (state === "SUCCEEDED" || state === "COMPLETED" || state === "FAILED" || state === "ERROR") {
      finalResponse = status
      break
    }
  }

  if (!finalResponse) {
    console.error("\n✗ FAIL – task did not reach a terminal state within timeout")
    process.exit(1)
  }

  let responseWithArtifacts = await waitForArtifacts(taskId, finalResponse, client)
  const initialArtifacts = Array.isArray(responseWithArtifacts.artifacts)
    ? responseWithArtifacts.artifacts
    : []

  if (initialArtifacts.length === 0) {
    console.log("   No artifacts found for the new run; checking latest PLAN run...")
    const fallbackRun = await fetchLatestPlanRun(client)
    if (fallbackRun) {
      responseWithArtifacts = fallbackRun
    }
  }

  // 3. Inspect the raw response
  console.log("\n3. Raw task response (key fields):")
  console.log(`   task_id       : ${responseWithArtifacts.task_id}`)
  console.log(`   state         : ${responseWithArtifacts.state}`)
  console.log(`   title         : ${responseWithArtifacts.title}`)
  console.log(`   session_link  : ${responseWithArtifacts.session_link}`)
  console.log(`   has artifacts : ${"artifacts" in responseWithArtifacts}`)
  console.log(`   artifacts     : ${JSON.stringify(responseWithArtifacts.artifacts, null, 2)}`)

  // 4. Assertions
  console.log("\n4. Assertions:")

  const hasField = "artifacts" in responseWithArtifacts
  console.log(`   [${hasField ? "✓" : "✗"}] 'artifacts' field present in response`)

  const artifacts = responseWithArtifacts.artifacts
  const isArray = Array.isArray(artifacts)
  console.log(`   [${isArray ? "✓" : "✗"}] 'artifacts' is an array`)

  if (isArray && artifacts.length > 0) {
    console.log(`   [✓] 'artifacts' is non-empty (count: ${artifacts.length})`)
    for (const a of artifacts) {
      console.log(`       → ${JSON.stringify(a)}`)
    }
  } else {
    console.log(`   [✗] 'artifacts' is empty after retries — no artifacts were returned for this task`)
  }

  // 5. Also test fetching a known completed task (if one was passed via CLI arg)
  const knownTaskId = process.argv[2]
  if (knownTaskId) {
    console.log(`\n5. Re-checking known task: ${knownTaskId}`)
    try {
      const known = await client.agent.runs.retrieve(knownTaskId, {
        query: { include: "artifacts" },
      })
      console.log(`   state     : ${known.state}`)
      console.log(`   artifacts : ${JSON.stringify(known.artifacts, null, 2)}`)
    } catch (e) {
      console.log(`   Error: ${e}`)
    }
  }

  console.log("\n=== Done ===")
  process.exit(hasField && isArray && (artifacts as unknown[]).length > 0 ? 0 : 1)
}

main().catch((err) => {
  console.error("Unhandled error:", err)
  process.exit(1)
})
