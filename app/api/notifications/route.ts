import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedWorkspaceContext,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"
import { eventBroadcaster } from "@/lib/event-broadcaster"

export async function GET() {
  try {
    const { userId, workspaceId } = await getAuthenticatedWorkspaceContext()
    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        room: { workspaceId },
      },
      include: {
        room: { select: { name: true } },
        agent: { select: { id: true, name: true, color: true, icon: true, status: true, activeRoomId: true } },
      },
      orderBy: { timestamp: "desc" },
    })
    return NextResponse.json(notifications)
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    console.error("GET /api/notifications error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { roomId, agentId, message } = body

    if (!roomId || !agentId || !message) {
      return NextResponse.json(
        { error: "roomId, agentId, and message are required" },
        { status: 400 }
      )
    }

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { workspaceId: true },
    })
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }
    if (!room.workspaceId) {
      return NextResponse.json({ error: "Room is not linked to a workspace" }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId, workspaceId: room.workspaceId },
      select: { id: true, name: true, color: true, icon: true, status: true, activeRoomId: true },
    })
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: room.workspaceId },
      select: { userId: true },
    })

    await prisma.notification.createMany({
      data: members.map((m) => ({
        roomId,
        agentId,
        message,
        userId: m.userId,
      })),
    })

    eventBroadcaster.broadcast({
      type: "notification",
      roomId,
      data: { action: "created" },
    })

    return NextResponse.json({ ok: true, created: members.length }, { status: 201 })
  } catch (error) {
    console.error("POST /api/notifications error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
