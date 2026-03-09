import { prisma } from "@/lib/prisma"

interface IntentClassifierAgent {
  id: string
  name: string
  systemPrompt?: string | null
}

interface ClassifyAgentsByIntentParams {
  roomId: string
  message: string
  agents: IntentClassifierAgent[]
}

type ICChatRole = "user" | "assistant"

type ICChatMessage = {
  role: ICChatRole
  text: string
  n_images: number
}

const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"

function getClassifierUrl() {
  return process.env.INTENT_CLASSIFIER_URL?.trim() || ""
}

function getClassifierAudience() {
  return process.env.INTENT_CLASSIFIER_AUDIENCE?.trim() || ""
}

function getClassifierBotName() {
  return process.env.INTENT_CLASSIFIER_BOT_NAME?.trim() || "warp"
}

function isClassifierDebugEnabled() {
  return (process.env.INTENT_CLASSIFIER_DEBUG || "false").toLowerCase() === "true"
}

async function getIdentityToken(audience: string): Promise<string | null> {
  const requestUrl = `${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}&format=full`
  try {
    const res = await fetch(requestUrl, {
      headers: { "Metadata-Flavor": "Google" },
    })
    if (!res.ok) {
      console.warn("[intent-classifier] metadata token fetch failed", res.status)
      return null
    }
    return await res.text()
  } catch (error) {
    console.warn("[intent-classifier] metadata token fetch error", error)
    return null
  }
}

function normalizeSelectedAgentIds(
  raw: unknown,
  validAgentIds: Set<string>,
  minConfidence: number
): string[] {
  if (!raw || typeof raw !== "object") return []

  const payload = raw as {
    selectedAgentIds?: unknown
    decisions?: unknown
  }

  if (Array.isArray(payload.selectedAgentIds)) {
    return payload.selectedAgentIds.filter(
      (id): id is string => typeof id === "string" && validAgentIds.has(id)
    )
  }

  if (Array.isArray(payload.decisions)) {
    return payload.decisions
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null
        const decision = entry as {
          agentId?: unknown
          shouldRespond?: unknown
          confidence?: unknown
        }

        if (typeof decision.agentId !== "string" || !validAgentIds.has(decision.agentId)) {
          return null
        }

        const confidence = typeof decision.confidence === "number" ? decision.confidence : null
        const shouldRespond =
          decision.shouldRespond === true ||
          (decision.shouldRespond !== false && confidence !== null && confidence >= minConfidence)

        return shouldRespond ? decision.agentId : null
      })
      .filter((id): id is string => !!id)
  }

  return []
}

function getV1Endpoint(base: string) {
  if (base.endsWith("/v1/classify-intent")) return base
  return `${base.replace(/\/$/, "")}/v1/classify-intent`
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function shortRoleDescription(systemPrompt?: string | null) {
  if (!systemPrompt) return ""
  const firstSentence = systemPrompt.split(/(?<=[.!?])\s+/)[0]?.trim() || ""
  return firstSentence.slice(0, 220)
}

async function getRecentRoomMessages(roomId: string) {
  const rows = await prisma.message.findMany({
    where: { roomId },
    include: {
      agent: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { timestamp: "desc" },
    take: 30,
  })

  return rows.reverse()
}

function buildChatHistoryForAgent(params: {
  candidate: IntentClassifierAgent
  roomMessages: Awaited<ReturnType<typeof getRecentRoomMessages>>
  allBotNames: string[]
  allHumanNames: string[]
}): ICChatMessage[] {
  const { candidate, roomMessages, allBotNames, allHumanNames } = params

  const participantNames = [...allHumanNames, ...allBotNames]
  const roleDescription = shortRoleDescription(candidate.systemPrompt)

  const systemLine = `System Message: There are ${participantNames.length} users in the conversation: ${participantNames.join(
    ", "
  )}. Your role is ${candidate.name}.${roleDescription ? ` ${roleDescription}` : ""}. Only respond if you think the message is relevant to your role.`

  const history: ICChatMessage[] = [{ role: "user", text: systemLine, n_images: 0 }]

  for (const m of roomMessages) {
    if (m.authorType === "agent") {
      const botName = m.agent?.name || "bot"
      history.push({
        role: m.authorId === candidate.id ? "assistant" : "user",
        text: `${botName}: ${m.content}`,
        n_images: 0,
      })
    } else {
      const userName = m.user?.name || "user"
      history.push({
        role: "user",
        text: `${userName}: ${m.content}`,
        n_images: 0,
      })
    }
  }

  return history
}

async function callV1ShouldRespond(params: {
  endpoint: string
  headers: Record<string, string>
  chatHistory: ICChatMessage[]
  botName: string
  timeoutMs: number
  modelNameOverride?: string
}): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)
  try {
    const body: {
      chat_history: ICChatMessage[]
      bot_name: string
      include_debug: boolean
      model_name_override?: string
    } = {
      chat_history: params.chatHistory,
      bot_name: params.botName,
      include_debug: false,
    }

    if (params.modelNameOverride) {
      body.model_name_override = params.modelNameOverride
    }

    const res = await fetch(params.endpoint, {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.warn("[intent-classifier] v1 non-OK response", res.status)
      return false
    }

    const json = (await res.json()) as { should_respond?: boolean }
    return json.should_respond === true
  } finally {
    clearTimeout(timeout)
  }
}

export async function classifyAgentsByIntent({
  roomId,
  message,
  agents,
}: ClassifyAgentsByIntentParams): Promise<string[]> {
  if (!message || agents.length === 0) return []

  const endpoint = getClassifierUrl()
  if (!endpoint) return []

  const apiKey = process.env.INTENT_CLASSIFIER_API_KEY
  const audience = getClassifierAudience()
  const timeoutMs = Number(process.env.INTENT_CLASSIFIER_TIMEOUT_MS || 8000)
  const minConfidence = Number(process.env.INTENT_CLASSIFIER_MIN_CONFIDENCE || 0.5)
  const modelNameOverride = process.env.INTENT_CLASSIFIER_MODEL_NAME_OVERRIDE?.trim() || undefined
  const classifierBotName = getClassifierBotName()

  try {
    const token = audience ? await getIdentityToken(audience) : null

    const authHeader = token ?? apiKey ?? null
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: `Bearer ${authHeader}` } : {}),
    }

    // Dev mock endpoint supports multi-agent response directly.
    if (endpoint.includes("/api/dev/mock-intent")) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          roomId,
          message,
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.systemPrompt ?? "",
          })),
        }),
      })
      if (!res.ok) return []
      const json = (await res.json()) as unknown
      return normalizeSelectedAgentIds(json, new Set(agents.map((a) => a.id)), minConfidence)
    }

    const roomMessages = await getRecentRoomMessages(roomId)

    const allHumanNames = unique(
      roomMessages
        .filter((m) => m.authorType !== "agent")
        .map((m) => m.user?.name || "user")
    )

    const allBotNames = unique([
      ...agents.map((a) => a.name),
      ...roomMessages
        .filter((m) => m.authorType === "agent")
        .map((m) => m.agent?.name || "bot"),
    ])

    const debug = isClassifierDebugEnabled()
    const v1Endpoint = getV1Endpoint(endpoint)

    if (debug) {
      console.log("[intent-classifier] debug enabled", {
        roomId,
        candidateCount: agents.length,
        classifierBotName,
        endpoint: v1Endpoint,
      })
    }

    const decisions = await Promise.all(
      agents.map(async (agent) => {
        try {
          const chatHistory = buildChatHistoryForAgent({
            candidate: agent,
            roomMessages,
            allBotNames,
            allHumanNames,
          })

          if (debug) {
            const payloadForLog = {
              candidateAgent: agent.name,
              endpoint: v1Endpoint,
              timeoutMs,
              requestBody: {
                bot_name: classifierBotName,
                include_debug: false,
                ...(modelNameOverride ? { model_name_override: modelNameOverride } : {}),
                chat_history: chatHistory,
              },
            }
            console.log(`[intent-classifier] payload ${JSON.stringify(payloadForLog)}`)
          }

          const shouldRespond = await callV1ShouldRespond({
            endpoint: v1Endpoint,
            headers,
            chatHistory,
            botName: classifierBotName,
            timeoutMs,
            modelNameOverride,
          })

          if (debug) {
            console.log("[intent-classifier] decision", {
              candidateAgent: agent.name,
              shouldRespond,
            })
          }

          return shouldRespond ? agent.id : null
        } catch (error) {
          console.warn(`[intent-classifier] v1 request failed for ${agent.name}`, error)
          return null
        }
      })
    )

    const selected = decisions.filter((id): id is string => !!id)
    if (debug) {
      console.log("[intent-classifier] selected", {
        selectedCount: selected.length,
        selectedIds: selected,
      })
    }
    return selected
  } catch (error) {
    console.warn("[intent-classifier] Request failed", error)
    return []
  }
}
