import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  requireRoomMembership,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"

async function ensureOwnerAccess(roomId: string) {
  const context = await requireRoomMembership(roomId)
  if (context.role !== "OWNER") {
    throw new ForbiddenError("Only room owners can manage members")
  }
  return context
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id, userId } = await params
    const { role } = await req.json()

    if (role !== "OWNER" && role !== "MEMBER") {
      return NextResponse.json({ error: "role must be OWNER or MEMBER" }, { status: 400 })
    }

    const { userId: currentUserId } = await ensureOwnerAccess(id)

    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: id, userId } },
      select: { role: true },
    })
    if (!membership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    if (membership.role === "OWNER" && role === "MEMBER") {
      const ownerCount = await prisma.roomMember.count({
        where: { roomId: id, role: "OWNER" },
      })
      if (ownerCount <= 1) {
        return NextResponse.json({ error: "Cannot remove the last owner" }, { status: 400 })
      }
      if (userId === currentUserId) {
        return NextResponse.json({ error: "Owners cannot demote themselves" }, { status: 400 })
      }
    }

    const updated = await prisma.roomMember.update({
      where: { roomId_userId: { roomId: id, userId } },
      data: { role },
      include: { user: { select: { id: true, name: true, email: true } } },
    })

    return NextResponse.json({
      userId: updated.userId,
      role: updated.role,
      invitedByUserId: updated.invitedByUserId,
      createdAt: updated.createdAt,
      user: updated.user,
    })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id, userId } = await params
    const { userId: currentUserId } = await ensureOwnerAccess(id)

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: id, userId } },
      select: { role: true },
    })
    if (!membership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    if (membership.role === "OWNER") {
      const ownerCount = await prisma.roomMember.count({
        where: { roomId: id, role: "OWNER" },
      })
      if (ownerCount <= 1) {
        return NextResponse.json({ error: "Cannot remove the last owner" }, { status: 400 })
      }
      if (userId === currentUserId) {
        return NextResponse.json({ error: "Owners cannot remove themselves" }, { status: 400 })
      }
    }

    await prisma.roomMember.delete({
      where: { roomId_userId: { roomId: id, userId } },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
