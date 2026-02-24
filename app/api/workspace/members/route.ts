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
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    })
    return NextResponse.json(
      members.map((m) => ({
        userId: m.userId,
        role: m.role,
        invitedByUserId: m.invitedByUserId,
        createdAt: m.createdAt,
        user: m.user,
      }))
    )
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
