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

    const [users, members] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, name: true, email: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.workspaceMember.findMany({
        where: { workspaceId },
        include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ])

    const memberIds = new Set(members.map((m) => m.userId))
    const nonMembers = users.filter((user) => !memberIds.has(user.id))

    return NextResponse.json({
      members: members.map((m) => ({
        userId: m.userId,
        role: m.role,
        invitedByUserId: m.invitedByUserId,
        createdAt: m.createdAt,
        user: m.user,
      })),
      nonMembers,
    })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
