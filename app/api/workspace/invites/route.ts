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
    const now = new Date()
    const invites = await prisma.workspaceInvite.findMany({
      where: {
        workspaceId,
        acceptedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json(invites)
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId, userId } = await getAuthenticatedWorkspaceContext()
    const body = await request.json().catch(() => ({}))
    const expiresInDays = Number(body?.expiresInDays)
    const expiresAt =
      Number.isFinite(expiresInDays) && expiresInDays > 0
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null

    const invite = await prisma.workspaceInvite.create({
      data: {
        workspaceId,
        createdByUserId: userId,
        role: "MEMBER",
        expiresAt,
      },
    })

    const origin = new URL(request.url).origin
    return NextResponse.json(
      {
        ...invite,
        inviteUrl: `${origin}/signup?invite=${invite.id}`,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
