import { prisma } from "@/lib/prisma"

interface IntentClassifierAgent {
  id: string
  name: string
  systemPrompt?: string | null
  intentRoleDescription?: string | null
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

type ICParticipant = {
  id: string
  role_description?: string
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

type IntentClassifierMode = "legacy" | "multi_agent_lora08" | "multi_agent_lora16"

function getClassifierMode(): IntentClassifierMode {
  const raw = (process.env.INTENT_CLASSIFIER_MODE || "legacy").trim().toLowerCase()
  if (raw === "multi_agent_lora08") return "multi_agent_lora08"
  if (raw === "multi_agent_lora16") return "multi_agent_lora16"
  return "legacy"
}

function getClassifierPath(mode: IntentClassifierMode) {
  if (mode === "multi_agent_lora08") return "/v1/classify-intent-multi-agent-lora08"
  if (mode === "multi_agent_lora16") return "/v1/classify-intent-multi-agent-lora16"
  return "/v1/classify-intent"
}

function getV1Endpoint(base: string, mode: IntentClassifierMode) {
  const trimmed = base.replace(/\/$/, "")
  const knownPaths = [
    "/v1/classify-intent",
    "/v1/classify-intent-multi-agent-lora08",
    "/v1/classify-intent-multi-agent-lora16",
  ]

  const matchedPath = knownPaths.find((path) => trimmed.endsWith(path))
  if (matchedPath) {
    const root = trimmed.slice(0, -matchedPath.length)
    return `${root}${getClassifierPath(mode)}`
  }

  return `${trimmed}${getClassifierPath(mode)}`
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function shortRoleDescription(systemPrompt?: string | null) {
  if (!systemPrompt) return ""
  const firstSentence = systemPrompt.split(/(?<=[.!?])\s+/)[0]?.trim() || ""
  return firstSentence.slice(0, 220)
}

function getAgentRoleDescription(agent: IntentClassifierAgent) {
  const explicit = agent.intentRoleDescription?.trim() || ""
  if (explicit) return explicit.slice(0, 220)
  return shortRoleDescription(agent.systemPrompt)
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
  allHumanAliases: string[]
  userAliasById: Map<string, string>
  includeSystemMessage: boolean
}): ICChatMessage[] {
  const { candidate, roomMessages, allBotNames, allHumanAliases, userAliasById, includeSystemMessage } = params

  const participantNames = [...allHumanAliases, ...allBotNames]
  const roleDescription = getAgentRoleDescription(candidate)

  const systemLine = `System Message: There are ${participantNames.length} users in the conversation: ${participantNames.join(
    ", "
  )}. Your role is ${candidate.name}.${roleDescription ? ` ${roleDescription}` : ""}. Only respond if you think the message is relevant to your role.`

  const history: ICChatMessage[] = []
  if (includeSystemMessage) {
    history.push({ role: "user", text: systemLine, n_images: 0 })
  }

  for (const m of roomMessages) {
    if (m.authorType === "agent") {
      const botName = m.agent?.name || "bot"
      history.push({
        role: m.authorId === candidate.id ? "assistant" : "user",
        text: `${botName}: ${m.content}`,
        n_images: 0,
      })
    } else {
      const userAlias = (m.user?.id && userAliasById.get(m.user.id)) || "user_1"
      history.push({
        role: "user",
        text: `${userAlias}: ${m.content}`,
        n_images: 0,
      })
    }
  }

  return history
}

function buildUserAliasMap(roomMessages: Awaited<ReturnType<typeof getRecentRoomMessages>>) {
  const userAliasById = new Map<string, string>()
  let counter = 0

  for (const m of roomMessages) {
    if (m.authorType === "agent") continue
    const userId = m.user?.id
    if (!userId) continue
    if (!userAliasById.has(userId)) {
      counter += 1
      userAliasById.set(userId, `user_${counter}`)
    }
  }

  const aliases = Array.from(userAliasById.values())
  if (aliases.length === 0) aliases.push("user_1")
  return { userAliasById, aliases }
}

async function callV1ShouldRespond(params: {
  mode: IntentClassifierMode
  endpoint: string
  headers: Record<string, string>
  chatHistory: ICChatMessage[]
  timeoutMs: number
  botName?: string
  currentAgentId?: string
  currentAgentRoleDescription?: string
  participants?: ICParticipant[]
  modelNameOverride?: string
}): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)
  try {
    const body: Record<string, unknown> = {
      chat_history: params.chatHistory,
      include_debug: false,
    }

    if (params.mode === "legacy") {
      body.bot_name = params.botName || "warp"
      if (params.modelNameOverride) {
        body.model_name_override = params.modelNameOverride
      }
    } else {
      body.current_agent_id = params.currentAgentId || ""
      body.current_agent_role_description = params.currentAgentRoleDescription || ""
      if (params.participants && params.participants.length > 0) {
        body.participants = params.participants
      }
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
  const classifierMode = getClassifierMode()

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

    const { userAliasById, aliases: allHumanAliases } = buildUserAliasMap(roomMessages)

    const allBotNames = unique([
      ...agents.map((a) => a.name),
      ...roomMessages
        .filter((m) => m.authorType === "agent")
        .map((m) => m.agent?.name || "bot"),
    ])

    const debug = isClassifierDebugEnabled()
    const v1Endpoint = getV1Endpoint(endpoint, classifierMode)
    const roleDescriptionByAgentName = new Map(
      agents.map((a) => [a.name, getAgentRoleDescription(a)] as const)
    )
    const agentParticipants: ICParticipant[] = allBotNames.map((name) => {
      const roleDescription = roleDescriptionByAgentName.get(name) || ""
      return {
        id: name,
        ...(roleDescription ? { role_description: roleDescription } : {}),
      }
    })
    const userParticipants: ICParticipant[] = allHumanAliases.map((alias) => ({ id: alias }))
    const participants: ICParticipant[] = [...agentParticipants, ...userParticipants]

    if (debug) {
      console.log("[intent-classifier] debug enabled", {
        roomId,
        candidateCount: agents.length,
        classifierBotName,
        classifierMode,
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
            allHumanAliases,
            userAliasById,
            includeSystemMessage: classifierMode === "legacy",
          })

          const currentAgentRoleDescription = getAgentRoleDescription(agent)
          const requestBodyForLog: Record<string, unknown> = {
            chat_history: chatHistory,
            include_debug: false,
          }

          if (classifierMode === "legacy") {
            requestBodyForLog.bot_name = classifierBotName
            if (modelNameOverride) {
              requestBodyForLog.model_name_override = modelNameOverride
            }
          } else {
            requestBodyForLog.current_agent_id = agent.name
            requestBodyForLog.current_agent_role_description = currentAgentRoleDescription
            requestBodyForLog.participants = participants
          }

          if (debug) {
            const payloadForLog = {
              candidateAgent: agent.name,
              endpoint: v1Endpoint,
              timeoutMs,
              requestBody: requestBodyForLog,
            }
            console.log(`[intent-classifier] payload ${JSON.stringify(payloadForLog)}`)
          }

          const shouldRespond = await callV1ShouldRespond({
            mode: classifierMode,
            endpoint: v1Endpoint,
            headers,
            chatHistory,
            timeoutMs,
            botName: classifierBotName,
            currentAgentId: agent.name,
            currentAgentRoleDescription,
            participants,
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
