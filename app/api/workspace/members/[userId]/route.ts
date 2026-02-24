import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedWorkspaceContext,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"

export async function DELETE(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { workspaceId, role, userId: currentUserId } = await getAuthenticatedWorkspaceContext()
    if (role !== "OWNER") {
      return forbiddenResponse("Only owners can remove members")
    }

    const { userId } = await params
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }
    if (userId === currentUserId) {
      return NextResponse.json({ error: "Owners cannot remove themselves" }, { status: 400 })
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
    if (!membership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    if (membership.role === "OWNER") {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId, role: "OWNER" },
      })
      if (ownerCount <= 1) {
        return NextResponse.json({ error: "Cannot remove the last owner" }, { status: 400 })
      }
    }

    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
