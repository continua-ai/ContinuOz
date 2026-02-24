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
    const { userId, workspaceId, role } = await getAuthenticatedWorkspaceContext()
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    })
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
    }
    return NextResponse.json({
      ...workspace,
      role,
      currentUserId: userId,
    })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
