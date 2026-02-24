import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedWorkspaceContext,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getAuthenticatedWorkspaceContext()
    const { id } = await params
    const invite = await prisma.workspaceInvite.findUnique({
      where: { id, workspaceId },
      select: { id: true, acceptedAt: true },
    })
    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 })
    }
    if (invite.acceptedAt) {
      return NextResponse.json({ error: "Invite already accepted" }, { status: 400 })
    }
    await prisma.workspaceInvite.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
