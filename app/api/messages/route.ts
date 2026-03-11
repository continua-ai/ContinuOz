import { NextResponse, after } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  requireRoomMembership,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"
import { eventBroadcaster } from "@/lib/event-broadcaster"
import { invokeAgent } from "@/lib/invoke-agent"
import { extractMentionedNames } from "@/lib/mentions"
import { classifyAgentsByIntent } from "@/lib/intent-classifier"

// Allow enough time for agent invocations triggered by mentions / classifier
export const maxDuration = 300

type AgentRoutingMode = "ic_only" | "hybrid"

function getAgentRoutingMode(): AgentRoutingMode {
  const raw = (process.env.AGENT_ROUTING_MODE || "ic_only").toLowerCase()
  return raw === "hybrid" ? "hybrid" : "ic_only"
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const roomId = searchParams.get("roomId")
    if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 })

    await requireRoomMembership(roomId)

    const limit = Math.min(Number(searchParams.get("limit")) || 50, 200)
    const cursor = searchParams.get("cursor") // message ID to paginate before

    let cursorTimestamp: Date | undefined
    if (cursor) {
      const cursorMsg = await prisma.message.findFirst({ where: { id: cursor, roomId } })
      if (!cursorMsg) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 })
      cursorTimestamp = cursorMsg.timestamp
    }

    const messages = await prisma.message.findMany({
      where: {
        roomId,
        ...(cursorTimestamp ? { timestamp: { lt: cursorTimestamp } } : {}),
      },
      include: {
        agent: { select: { id: true, name: true, color: true, icon: true, status: true, activeRoomId: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { timestamp: "desc" },
      take: limit,
    })

    // Reverse so messages are in chronological order
    messages.reverse()

    const hasMore = messages.length === limit

    return NextResponse.json({
      messages: messages.map((m) => ({
        ...m,
        author: m.authorType === "agent" ? m.agent : undefined,
        agent: undefined,
        user: m.authorType === "human" ? m.user : undefined,
      })),
      hasMore,
      nextCursor: messages.length > 0 ? messages[0].id : null,
    })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    console.error("GET /api/messages error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { roomId, content, authorType = "human", authorId, sessionUrl } = body

    if (!roomId) {
      return NextResponse.json({ error: "roomId required" }, { status: 400 })
    }

    const { userId, workspaceId } = await requireRoomMembership(roomId)
    const room = await prisma.room.findUnique({ where: { id: roomId } })
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 })

    const message = await prisma.message.create({
      data: {
        content,
        authorType,
        sessionUrl: sessionUrl ?? null,
        userId,
        roomId,
        authorId: authorType !== "human" && authorId ? authorId : null,
      },
      include: {
        agent: { select: { id: true, name: true, color: true, icon: true, status: true, activeRoomId: true } },
        user: { select: { id: true, name: true } },
      },
    })

    const responseMessage = {
      ...message,
      author: message.authorType === "agent" ? message.agent : undefined,
      agent: undefined,
      user: message.authorType === "human" ? message.user : undefined,
    }

    // Broadcast new message to SSE subscribers
    eventBroadcaster.broadcast({
      type: "message",
      roomId,
      data: responseMessage,
    })

    // Agent routing modes:
    // - ic_only (default): ignore direct @mentions for agent dispatch, rely only on IC.
    // - hybrid: direct @mentions dispatch first, IC only evaluates unmentioned agents.
    if (authorType === "human" && typeof content === "string" && !room.paused) {
      const routingMode = getAgentRoutingMode()

      const roomAgents = await prisma.roomAgent.findMany({
        where: { roomId },
        include: { agent: true },
      })

      const agents = roomAgents.map((ra) => ra.agent)
      const allOzAgents = agents.filter((agent) => agent.harness === "oz")

      const mentionedNames =
        routingMode === "hybrid" ? extractMentionedNames(content, agents.map((a) => a.name)) : []
      const mentionedSet = new Set(mentionedNames.map((n) => n.toLowerCase()))

      const mentionedOzAgents =
        routingMode === "hybrid"
          ? allOzAgents.filter((agent) => mentionedSet.has(agent.name.toLowerCase()))
          : []

      const classifierCandidates =
        routingMode === "hybrid"
          ? allOzAgents.filter((agent) => !mentionedSet.has(agent.name.toLowerCase()))
          : allOzAgents

      const classifierSelectedIds = await classifyAgentsByIntent({
        roomId,
        message: content,
        agents: classifierCandidates.map((a) => ({
          id: a.id,
          name: a.name,
          systemPrompt: a.systemPrompt,
          intentRoleDescription: a.intentRoleDescription,
        })),
      })
      const classifierSelectedSet = new Set(classifierSelectedIds)

      const classifierOzAgents = classifierCandidates.filter((a) => classifierSelectedSet.has(a.id))

      // In hybrid mode, direct mentions win precedence and IC only contributes unmentioned agents.
      // In ic_only mode, mentionedOzAgents is always empty.
      const targetAgentMap = new Map<string, (typeof agents)[number]>()
      for (const agent of mentionedOzAgents) targetAgentMap.set(agent.id, agent)
      for (const agent of classifierOzAgents) targetAgentMap.set(agent.id, agent)
      const targetAgents = Array.from(targetAgentMap.values())

      if (targetAgents.length > 0) {
        await prisma.agent.updateMany({
          where: { id: { in: targetAgents.map((a) => a.id) } },
          data: { status: "running", activeRoomId: roomId },
        })

        eventBroadcaster.broadcast({ type: "room", roomId, data: null })

        after(async () => {
          await Promise.allSettled(
            targetAgents.map((targetAgent) => {
              console.log(`[messages] Scheduling agent dispatch: ${targetAgent.name}`)
              return invokeAgent({
                roomId,
                agentId: targetAgent.id,
                prompt: content,
                depth: 0,
                userId,
                workspaceId: workspaceId ?? undefined,
              }).catch((err) => {
                console.error(`[messages] Failed to invoke agent ${targetAgent.name}:`, err)
              })
            })
          )
        })
      }

      if (userId) {
        const roomMembers = await prisma.roomMember.findMany({
          where: { roomId },
          include: { user: { select: { id: true, name: true } } },
        })
        const otherUsers = roomMembers
          .map((m) => m.user)
          .filter((u): u is { id: string; name: string } => !!u && u.id !== userId)

        const mentionedUserNames = extractMentionedNames(
          content,
          otherUsers.map((u) => u.name)
        )

        if (mentionedUserNames.length > 0) {
          const mentionedUserMap = new Map(otherUsers.map((u) => [u.name.toLowerCase(), u]))
          const mentionedUsers = mentionedUserNames
            .map((name) => mentionedUserMap.get(name.toLowerCase()))
            .filter((u): u is { id: string; name: string } => !!u)

          if (mentionedUsers.length > 0) {
            await prisma.notification.createMany({
              data: mentionedUsers.map((u) => ({
                roomId,
                agentId: null,
                senderUserId: userId,
                message: content,
                userId: u.id,
              })),
            })
            eventBroadcaster.broadcast({ type: "notification", roomId, data: { action: "created" } })
          }
        }
      }
    }

    return NextResponse.json(responseMessage)
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    console.error("POST /api/messages error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
