import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  requireRoomMembership,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requireRoomMembership(id)

    const members = await prisma.roomMember.findMany({
      where: { roomId: id },
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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { userId, role } = await req.json()

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }
    if (role && role !== "OWNER" && role !== "MEMBER") {
      return NextResponse.json({ error: "role must be OWNER or MEMBER" }, { status: 400 })
    }

    const { userId: inviterId, role: inviterRole, workspaceId } = await requireRoomMembership(id)
    if (inviterRole !== "OWNER") {
      return forbiddenResponse("Only room owners can add members")
    }

    if (workspaceId) {
      const workspaceMembership = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { userId: true },
      })
      if (!workspaceMembership) {
        return NextResponse.json({ error: "User is not in this workspace" }, { status: 400 })
      }
    }

    const existing = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: id, userId } },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ error: "User is already a room member" }, { status: 409 })
    }

    const member = await prisma.roomMember.create({
      data: {
        roomId: id,
        userId,
        role: role ?? "MEMBER",
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
