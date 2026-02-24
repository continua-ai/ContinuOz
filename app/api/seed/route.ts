import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedWorkspaceContext,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"
import { seedNewAccount } from "@/lib/seed-account"

export async function POST() {
  try {
    const { userId, workspaceId } = await getAuthenticatedWorkspaceContext()

    const workspaceRoomIds = (
      await prisma.room.findMany({
        where: { workspaceId },
        select: { id: true },
      })
    ).map((r) => r.id)

    if (workspaceRoomIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { roomId: { in: workspaceRoomIds } },
      })
      await prisma.artifact.deleteMany({
        where: { roomId: { in: workspaceRoomIds } },
      })
      await prisma.message.deleteMany({
        where: { roomId: { in: workspaceRoomIds } },
      })
      await prisma.task.deleteMany({
        where: { roomId: { in: workspaceRoomIds } },
      })
      await prisma.roomAgent.deleteMany({ where: { roomId: { in: workspaceRoomIds } } })
      await prisma.room.deleteMany({ where: { id: { in: workspaceRoomIds } } })
    }

    await prisma.agent.deleteMany({ where: { workspaceId } })

    await seedNewAccount(userId, workspaceId)

    return NextResponse.json({ ok: true, message: "Seed data created successfully" })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    console.error("POST /api/seed error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
