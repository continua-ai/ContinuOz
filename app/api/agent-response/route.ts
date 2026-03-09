import { NextResponse, after } from "next/server"
import { prisma } from "@/lib/prisma"
import { eventBroadcaster } from "@/lib/event-broadcaster"
import { tryDecodeAgentCallbackPayload } from "@/lib/agent-callback"
import { invokeAgent } from "@/lib/invoke-agent"
import { getTaskStatus } from "@/lib/oz-client"
import { saveWarpArtifacts } from "@/lib/warp-artifacts"
import { classifyAgentsByIntent } from "@/lib/intent-classifier"

// This route can fan out follow-up invocations and persist artifacts after the response is sent.
export const maxDuration = 300
function generateInvocationId() {
  return `inv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}
function sanitizeDelegateText(text: string) {
  // Avoid accidental re-dispatch if the lead copies delegate responses containing @mentions.
  return text.replaceAll("@", "＠")
}
function trimForPrompt(text: string, maxChars: number) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`
}

// POST - Agent sends its response here
export async function POST(request: Request) {
  try {
    const body = await request.json()
    // Accept both camelCase and snake_case field names
    const taskId = body.taskId || body.task_id
    const rawResponse = body.response || body.message

    if (!taskId || !rawResponse) {
      console.log("[agent-response] Missing fields. Body keys:", Object.keys(body))
      return NextResponse.json(
        { error: "taskId and response are required" },
        { status: 400 }
      )
    }
    const response = typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse)
    console.log(`[agent-response] Received response for task ${taskId}:`, response.substring(0, 100))

    const url = new URL(request.url)
    const decoded = tryDecodeAgentCallbackPayload(response)

    const roomId = url.searchParams.get("roomId") ?? decoded?.roomId ?? null
    const agentId = url.searchParams.get("agentId") ?? decoded?.agentId ?? null
    const messageText = decoded?.message ?? response

    // If we have enough context, persist the agent message immediately so the room updates
    // even if the long-running invokeAgent serverless function is killed.
    if (roomId && agentId) {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { userId: true, workspaceId: true },
      })
      const userIdForInvocations = decoded?.userId ?? room?.userId ?? null
      const workspaceIdForInvocations = room?.workspaceId ?? undefined

      const message = await prisma.message.upsert({
        where: { id: taskId },
        create: {
          id: taskId,
          content: messageText,
          authorType: "agent",
          sessionUrl: null,
          userId: decoded?.userId ?? room?.userId ?? null,
          roomId,
          authorId: agentId,
        },
        update: {
          content: messageText,
        },
        include: {
          agent: { select: { id: true, name: true, color: true, icon: true, status: true, activeRoomId: true } },
        },
      })

      // Clear thinking state (only if agent is still tied to this room).
      await prisma.agent.updateMany({
        where: { id: agentId, activeRoomId: roomId },
        data: { status: "idle", activeRoomId: null },
      })

      eventBroadcaster.broadcast({
        type: "message",
        roomId,
        data: { ...message, author: message.agent, agent: undefined },
      })
      eventBroadcaster.broadcast({ type: "room", roomId, data: null })

      // Best-effort: persist artifacts produced by the Warp run. We can't rely on the original
      // invoker surviving long enough to poll to completion on Vercel.
      try {
        const marker = await prisma.agentCallback.findUnique({
          where: { id: `warp-run:${taskId}` },
          select: { response: true },
        })
        const warpRunId = marker?.response
        if (warpRunId) {
          after(async () => {
            for (let attempt = 0; attempt < 6; attempt++) {
              try {
                const status = await getTaskStatus(warpRunId, userIdForInvocations, workspaceIdForInvocations)
                const artifacts = status.artifacts ?? []
                if (artifacts.length > 0) {
                  await saveWarpArtifacts(artifacts, { roomId, agentId, userId: userIdForInvocations })
                  break
                }

                // If the run is terminal and still has no artifacts, don't keep retrying.
                if (status.state === "completed" || status.state === "failed") break
              } catch (err) {
                console.error("[agent-response] Failed to fetch/save artifacts:", err)
              }

              // Backoff: 2s, 4s, 6s, 8s, 10s, 12s
              await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
            }
          })
        }
      } catch (err) {
        console.error("[agent-response] Failed to schedule artifact persistence:", err)
      }

      // Fan-in: if this callback corresponds to an orchestration child run, mark it completed and
      // dispatch the lead exactly once when all children are complete.
      let activeChildOrchestration: { id: string; leadAgentId: string; status: string } | null = null
      try {
        const child = await prisma.agentOrchestrationChild.findUnique({
          where: { runId: taskId },
          include: {
            orchestration: {
              select: { id: true, leadAgentId: true, leadRunId: true, followupRunId: true, status: true },
            },
          },
        })
        if (child) {
          if (child.orchestration.status === "running") {
            activeChildOrchestration = {
              id: child.orchestration.id,
              leadAgentId: child.orchestration.leadAgentId,
              status: child.orchestration.status,
            }
          }

          // Best-effort: mark child completed (idempotent).
          await prisma.agentOrchestrationChild.updateMany({
            where: { runId: taskId, status: { not: "completed" } },
            data: { status: "completed", completedAt: new Date() },
          })

          const remaining = await prisma.agentOrchestrationChild.count({
            where: { orchestrationId: child.orchestration.id, status: { not: "completed" } },
          })

          if (
            remaining === 0 &&
            child.orchestration.status === "running" &&
            child.orchestration.followupRunId === null
          ) {
            const followupRunId = generateInvocationId()

            // Dedupe: only one callback handler should win the fan-in dispatch.
            const updated = await prisma.agentOrchestration.updateMany({
              where: { id: child.orchestration.id, followupRunId: null },
              data: { followupRunId, status: "completed" },
            })

            if (updated.count === 1) {
              const [leadMessage, children] = await Promise.all([
                prisma.message.findUnique({
                  where: { id: child.orchestration.leadRunId },
                  select: { content: true },
                }),
                prisma.agentOrchestrationChild.findMany({
                  where: { orchestrationId: child.orchestration.id },
                  include: { agent: { select: { name: true } } },
                  orderBy: { createdAt: "asc" },
                }),
              ])

              const childRunIds = children.map((c) => c.runId)
              const childMessages = await prisma.message.findMany({
                where: { id: { in: childRunIds } },
                select: { id: true, content: true },
              })
              const msgById = new Map(childMessages.map((m) => [m.id, m.content] as const))

              const delegateSections = children
                .map((c) => {
                  const raw = msgById.get(c.runId) ?? "(no response)"
                  const safe = trimForPrompt(sanitizeDelegateText(raw), 8_000)
                  return `Agent ${c.agent.name}:\n${safe}`
                })
                .join("\n\n")

              const leadOriginal = trimForPrompt(sanitizeDelegateText(leadMessage?.content ?? "(missing)"), 8_000)
              const followupPrompt = [
                "You delegated work to multiple agents. All delegate responses have arrived.",
                "",
                "Continue from the original request and produce a single consolidated response to the room.",
                "",
                "IMPORTANT: Do NOT include any @mentions in your response unless you intend to dispatch another agent.",
                "",
                "Original message:",
                leadOriginal,
                "",
                "Delegate responses:",
                delegateSections,
              ].join("\n")

              after(
                invokeAgent({
                  roomId,
                  agentId: child.orchestration.leadAgentId,
                  prompt: followupPrompt,
                  depth: 1,
                  userId: userIdForInvocations,
                  workspaceId: workspaceIdForInvocations,
                  invocationId: followupRunId,
                }).catch((err) => {
                  console.error("[agent-response] Failed to invoke lead for fan-in:", err)
                })
              )
            }
          }
        }
      } catch (err) {
        console.error("[agent-response] Failed to process orchestration fan-in:", err)
      }
      // Agent-to-agent @mention dispatch is intentionally disabled.
      // Instead, every agent message triggers IC-based routing across room agents.
      // Skip dispatch if the room is paused (responses are still accepted, but no new agents are invoked).
      const roomForPause = await prisma.room.findUnique({ where: { id: roomId }, select: { paused: true } })
      if (roomForPause?.paused) {
        console.log("[agent-response] Room is paused, skipping IC dispatch")
      } else {
        try {
          const roomAgents = await prisma.roomAgent.findMany({
            where: { roomId },
            include: { agent: true },
          })

          const icCandidates = roomAgents
            .map((ra) => ra.agent)
            .filter((a) => a.harness === "oz" && a.id !== agentId)

          const selectedIds = await classifyAgentsByIntent({
            roomId,
            message: messageText,
            agents: icCandidates.map((a) => ({
              id: a.id,
              name: a.name,
              systemPrompt: a.systemPrompt,
            })),
          })

          const selectedSet = new Set(selectedIds)
          let selectedAgents = icCandidates.filter((a) => selectedSet.has(a.id))

          // Suppress premature delegate→lead dispatch while an orchestration is running.
          if (activeChildOrchestration?.status === "running") {
            selectedAgents = selectedAgents.filter((a) => a.id !== activeChildOrchestration!.leadAgentId)
          }

          const dispatchable: Array<{ agent: (typeof selectedAgents)[number]; invocationId: string }> = []
          for (const selectedAgent of selectedAgents) {
            const markerId = `ic-dispatch:${taskId}:${selectedAgent.id}`
            const marker = await prisma.agentCallback.findUnique({
              where: { id: markerId },
              select: { response: true },
            })
            if (marker) continue

            const childRunId = generateInvocationId()
            try {
              await prisma.agentCallback.create({ data: { id: markerId, response: childRunId } })
            } catch {
              continue
            }

            dispatchable.push({ agent: selectedAgent, invocationId: childRunId })
          }

          if (dispatchable.length > 0) {
            await prisma.agent.updateMany({
              where: { id: { in: dispatchable.map((d) => d.agent.id) } },
              data: { status: "running", activeRoomId: roomId },
            })
            eventBroadcaster.broadcast({ type: "room", roomId, data: null })
          }

          for (const { agent: selectedAgent, invocationId } of dispatchable) {
            console.log(`[agent-response] Scheduling IC-selected agent: ${selectedAgent.name} (${invocationId})`)
            after(
              invokeAgent({
                roomId,
                agentId: selectedAgent.id,
                prompt: messageText,
                depth: 1,
                userId: userIdForInvocations,
                workspaceId: workspaceIdForInvocations,
                invocationId,
              }).catch((err) => {
                console.error(`[agent-response] Failed to invoke IC-selected agent ${selectedAgent.name}:`, err)
              })
            )
          }
        } catch (err) {
          console.error("[agent-response] Failed to dispatch IC-selected agents:", err)
        }
      }
    } else {
      // Store in database (upsert in case of retry) so invokeAgent can poll and create the message.
      await prisma.agentCallback.upsert({
        where: { id: taskId },
        create: { id: taskId, response: messageText },
        update: { response: messageText },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[agent-response] POST error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

// GET - Poll for agent response
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const taskId = searchParams.get("taskId")

    if (!taskId) {
      return NextResponse.json({ error: "taskId required" }, { status: 400 })
    }

    const callback = await prisma.agentCallback.findUnique({
      where: { id: taskId },
    })

    if (callback) {
      // Remove after reading (one-time use)
      await prisma.agentCallback.delete({ where: { id: taskId } })
      return NextResponse.json({ response: callback.response })
    }

    return NextResponse.json({ response: null })
  } catch (error) {
    console.error("[agent-response] GET error:", error)
    return NextResponse.json({ response: null })
  }
}
