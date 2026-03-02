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
    const { userId, workspaceId } = await getAuthenticatedWorkspaceContext()
    const rooms = await prisma.room.findMany({
      where: {
        workspaceId,
        OR: [
          { userId },
          {
            members: {
              some: {
                userId,
              },
            },
          },
        ],
      },
      include: {
        agents: {
          include: { agent: { select: { id: true, name: true, color: true, icon: true, status: true, activeRoomId: true } } },
        },
        members: {
          where: { userId },
          select: { role: true },
        },
      },
      orderBy: { createdAt: "asc" },
    })

    return NextResponse.json(
      rooms.map((r) => ({
        ...r,
        memberRole: r.userId === userId ? "OWNER" : (r.members[0]?.role ?? "MEMBER"),
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
    const { name, description = "", agentIds = [], memberUserIds = [] } = body

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

    const cleanedMemberIds = Array.isArray(memberUserIds)
      ? memberUserIds.filter((memberId: string) => memberId && memberId !== userId)
      : []

    if (cleanedMemberIds.length > 0) {
      const allowedMemberCount = await prisma.workspaceMember.count({
        where: { workspaceId, userId: { in: cleanedMemberIds } },
      })
      if (allowedMemberCount !== cleanedMemberIds.length) {
        return NextResponse.json({ error: "One or more users are not in this workspace" }, { status: 400 })
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
        members: {
          create: [
            {
              userId,
              role: "OWNER" as const,
              invitedByUserId: null,
            },
            ...cleanedMemberIds.map((memberId) => ({
              userId: memberId,
              role: "MEMBER" as const,
              invitedByUserId: userId,
            })),
          ],
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
