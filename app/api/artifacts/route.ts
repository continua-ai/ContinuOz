import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedWorkspaceContext,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"

export async function GET(request: Request) {
  try {
    const { workspaceId } = await getAuthenticatedWorkspaceContext()
    const { searchParams } = new URL(request.url)
    const roomId = searchParams.get("roomId")
    if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 })

    const room = await prisma.room.findUnique({ where: { id: roomId, workspaceId } })
    if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const artifacts = await prisma.artifact.findMany({
      where: { roomId },
      include: {
        agent: { select: { id: true, name: true, color: true, icon: true, status: true, activeRoomId: true } },
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(artifacts)
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    console.error("GET /api/artifacts error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { userId, workspaceId } = await getAuthenticatedWorkspaceContext()
    const body = await request.json()

    const room = await prisma.room.findUnique({ where: { id: body.roomId, workspaceId } })
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 })

    const artifact = await prisma.artifact.create({
      data: {
        type: body.type,
        title: body.title,
        content: body.content ?? "",
        url: body.url ?? null,
        userId,
        roomId: body.roomId,
        createdBy: body.createdBy ?? null,
      },
      include: {
        agent: { select: { id: true, name: true, color: true, icon: true, status: true, activeRoomId: true } },
      },
    })
    return NextResponse.json(artifact)
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    console.error("POST /api/artifacts error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
