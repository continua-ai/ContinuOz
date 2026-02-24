import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedWorkspaceContext,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"

export async function POST() {
  try {
    const { userId, workspaceId } = await getAuthenticatedWorkspaceContext()
    await prisma.notification.updateMany({
      where: { userId, read: false, room: { workspaceId } },
      data: { read: true },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
