import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedUserId,
  ACTIVE_WORKSPACE_COOKIE,
  AuthError,
  unauthorizedResponse,
} from "@/lib/auth-helper"

export async function POST(request: Request) {
  try {
    const userId = await getAuthenticatedUserId()
    const body = await request.json()
    const { workspaceId } = body

    if (!workspaceId || typeof workspaceId !== "string") {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 })
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: { select: { id: true, name: true, createdAt: true, updatedAt: true } } },
    })

    if (!membership) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 })
    }

    const cookieStore = await cookies()
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    })

    return NextResponse.json({
      ...membership.workspace,
      role: membership.role,
      currentUserId: userId,
    })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    console.error("POST /api/workspace/switch error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
