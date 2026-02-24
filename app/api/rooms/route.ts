import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedWorkspaceContext,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"

export async function GET() {
  try {
    const { workspaceId } = await getAuthenticatedWorkspaceContext()
    const rooms = await prisma.room.findMany({
      where: { workspaceId },
      include: {
        agents: {
          include: { agent: { select: { id: true, name: true, color: true, icon: true, status: true, activeRoomId: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    })

    return NextResponse.json(
      rooms.map((r) => ({
        ...r,
        agents: r.agents.map((ra) => ra.agent),
      }))
    )
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}

export async function POST(request: Request) {
  try {
    const { userId, workspaceId } = await getAuthenticatedWorkspaceContext()
    const body = await request.json()
    const { name, description = "", agentIds = [] } = body

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }

    if (Array.isArray(agentIds) && agentIds.length > 0) {
      const allowedAgentCount = await prisma.agent.count({
        where: { id: { in: agentIds }, workspaceId },
      })
      if (allowedAgentCount !== agentIds.length) {
        return NextResponse.json({ error: "One or more agents are not in this workspace" }, { status: 400 })
      }
    }

    const room = await prisma.room.create({
      data: {
        name,
        description,
        workspaceId,
        userId,
        agents: {
          create: agentIds.map((agentId: string) => ({
            agent: { connect: { id: agentId } },
          })),
        },
      },
      include: {
        agents: {
          include: { agent: { select: { id: true, name: true, color: true, icon: true, status: true, activeRoomId: true } } },
        },
      },
    })

    return NextResponse.json({
      ...room,
      agents: room.agents.map((ra) => ra.agent),
    })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    console.error("POST /api/rooms error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
