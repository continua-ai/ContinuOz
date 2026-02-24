import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedWorkspaceContext,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"
import { invokeAgent } from "@/lib/invoke-agent"

export const maxDuration = 300

export async function POST(request: Request) {
  console.log("[invoke] Received request")
  try {
    const { userId, workspaceId } = await getAuthenticatedWorkspaceContext()
    const body = await request.json()
    const { roomId, agentId, prompt, depth } = body
    console.log("[invoke] Body:", { roomId, agentId, promptLength: prompt?.length, depth })

    if (!roomId || !agentId || !prompt) {
      return NextResponse.json(
        { error: "roomId, agentId, and prompt are required" },
        { status: 400 }
      )
    }

    if (depth !== undefined && depth !== 0) {
      return NextResponse.json(
        { error: "depth must be 0" },
        { status: 400 }
      )
    }

    const room = await prisma.room.findUnique({ where: { id: roomId, workspaceId } })
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 })

    const membership = await prisma.roomAgent.findUnique({
      where: { roomId_agentId: { roomId, agentId } },
      select: { id: true },
    })
    if (!membership) return NextResponse.json({ error: "Agent not found in room" }, { status: 404 })

    const result = await invokeAgent({ roomId, agentId, prompt, depth: 0, userId, workspaceId })

    if (!result.success && !result.message) {
      return NextResponse.json(
        { error: result.error },
        { status: result.errorStatus || 500 }
      )
    }

    return NextResponse.json(result.message)
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    console.error("POST /api/invoke error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
