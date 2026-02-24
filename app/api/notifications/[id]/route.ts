import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedWorkspaceContext,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, workspaceId } = await getAuthenticatedWorkspaceContext()
    const { id } = await params
    const existing = await prisma.notification.findFirst({
      where: { id, userId, room: { workspaceId } },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const notification = await prisma.notification.update({
      where: { id },
      data: { read: true },
    })
    return NextResponse.json(notification)
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, workspaceId } = await getAuthenticatedWorkspaceContext()
    const { id } = await params
    const existing = await prisma.notification.findFirst({
      where: { id, userId, room: { workspaceId } },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
    await prisma.notification.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
