import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { getAuthenticatedUserId, AuthError, unauthorizedResponse, ACTIVE_WORKSPACE_COOKIE } from "@/lib/auth-helper"

export async function POST(request: Request) {
  try {
    const userId = await getAuthenticatedUserId()
    const body = await request.json()
    const inviteId = body?.inviteId

    if (!inviteId || typeof inviteId !== "string") {
      return NextResponse.json({ error: "inviteId is required" }, { status: 400 })
    }

    const invite = await prisma.workspaceInvite.findUnique({
      where: { id: inviteId },
      select: {
        id: true,
        workspaceId: true,
        role: true,
        createdByUserId: true,
        acceptedAt: true,
        expiresAt: true,
      },
    })
    if (!invite) {
      return NextResponse.json({ error: "Invalid invite link" }, { status: 404 })
    }
    if (invite.acceptedAt) {
      return NextResponse.json({ error: "Invite already accepted" }, { status: 400 })
    }
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return NextResponse.json({ error: "Invite link has expired" }, { status: 400 })
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
        select: { userId: true },
      })

      if (!existing) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: invite.workspaceId,
            userId,
            role: invite.role,
            invitedByUserId: invite.createdByUserId,
          },
        })
      }

      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      })
    })

    // Switch the user's active workspace to the one they just joined
    const cookieStore = await cookies()
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, invite.workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    })

    return NextResponse.json({ ok: true, workspaceId: invite.workspaceId })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    console.error("POST /api/workspace/invites/accept error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
