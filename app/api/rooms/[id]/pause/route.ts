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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getAuthenticatedWorkspaceContext()
    const { id } = await params
    const existing = await prisma.room.findUnique({ where: { id, workspaceId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const body = await req.json()
    const { paused } = body as { paused: boolean }

    const room = await prisma.room.update({
      where: { id },
      data: { paused },
      include: {
        agents: {
          include: { agent: { select: { id: true, name: true, color: true, icon: true, status: true, activeRoomId: true } } },
        },
      },
    })

    const roomData = { ...room, agents: room.agents.map((ra) => ra.agent) }

    eventBroadcaster.broadcast({ type: "room", roomId: id, data: roomData })

    return NextResponse.json(roomData)
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
