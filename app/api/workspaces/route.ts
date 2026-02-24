import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedUserId,
  ACTIVE_WORKSPACE_COOKIE,
  AuthError,
  unauthorizedResponse,
} from "@/lib/auth-helper"
import { seedNewAccount } from "@/lib/seed-account"

export async function GET() {
  try {
    const userId = await getAuthenticatedUserId()
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: { select: { id: true, name: true, createdAt: true, updatedAt: true } } },
      orderBy: { createdAt: "asc" },
    })
    return NextResponse.json(
      memberships.map((m) => ({
        ...m.workspace,
        role: m.role,
        currentUserId: userId,
      }))
    )
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    throw error
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getAuthenticatedUserId()
    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }

    const workspace = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({ data: { name } })
      await tx.workspaceMember.create({
        data: { workspaceId: ws.id, userId, role: "OWNER" },
      })
      return ws
    })

    // Seed starter agents and demo room (non-fatal if it fails)
    try {
      await seedNewAccount(userId, workspace.id)
    } catch (seedError) {
      console.error("Failed to seed new workspace:", seedError)
    }

    // Set active workspace cookie to the newly created workspace
    const cookieStore = await cookies()
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspace.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    })

    return NextResponse.json(
      { ...workspace, role: "OWNER", currentUserId: userId },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    console.error("POST /api/workspaces error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
