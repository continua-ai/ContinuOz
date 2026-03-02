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

export async function POST(request: Request) {
  try {
    const { workspaceId, role, userId: inviterId } = await getAuthenticatedWorkspaceContext()
    if (role !== "OWNER") {
      return forbiddenResponse("Only owners can add members")
    }

    const body = await request.json()
    const { userId } = body as { userId?: string }
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { userId: true },
    })
    if (existing) {
      return NextResponse.json({ error: "User already in workspace" }, { status: 409 })
    }

    const member = await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId,
        role: "MEMBER",
        invitedByUserId: inviterId,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json(
      {
        userId: member.userId,
        role: member.role,
        invitedByUserId: member.invitedByUserId,
        createdAt: member.createdAt,
        user: member.user,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
