import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export type WorkspaceRole = "OWNER" | "MEMBER"
export type RoomRole = "OWNER" | "MEMBER"

export interface WorkspaceContext {
  userId: string
  workspaceId: string
  role: WorkspaceRole
}

export interface RoomContext {
  userId: string
  roomId: string
  role: RoomRole
  workspaceId: string | null
}

export const ACTIVE_WORKSPACE_COOKIE = "active_workspace_id"
const TEST_USER_COOKIE = "test_user_id"

export async function getAuthenticatedUserId(): Promise<string> {
  if (process.env.TEST_AUTH_MODE === "true") {
    const cookieStore = await cookies()
    const testUserId = cookieStore.get(TEST_USER_COOKIE)?.value
    if (!testUserId) {
      throw new AuthError()
    }
    return testUserId
  }

  const session = await auth()
  if (!session?.user?.id) {
    throw new AuthError()
  }
  return session.user.id
}

export async function getAuthenticatedWorkspaceContext(): Promise<WorkspaceContext> {
  const userId = await getAuthenticatedUserId()
  const cookieStore = await cookies()
  const cookieWorkspaceId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value

  // Try the cookie workspace first
  if (cookieWorkspaceId) {
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: cookieWorkspaceId, userId } },
      select: { workspaceId: true, role: true },
    })
    if (membership) {
      return {
        userId,
        workspaceId: membership.workspaceId,
        role: membership.role as WorkspaceRole,
      }
    }
  }

  // Fall back to most recently joined workspace
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    select: { workspaceId: true, role: true },
    orderBy: { createdAt: "desc" },
  })
  if (!membership) {
    throw new ForbiddenError("No workspace membership")
  }

  // Clear any stale cookie so future requests skip the extra DB lookup
  if (cookieWorkspaceId) {
    cookieStore.delete(ACTIVE_WORKSPACE_COOKIE)
  }

  return {
    userId,
    workspaceId: membership.workspaceId,
    role: membership.role as WorkspaceRole,
  }
}

export async function requireWorkspaceMembership(workspaceId: string): Promise<WorkspaceContext> {
  const userId = await getAuthenticatedUserId()
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  })
  if (!membership) {
    throw new ForbiddenError()
  }
  return {
    userId,
    workspaceId,
    role: membership.role as WorkspaceRole,
  }
}

export async function requireRoomMembership(roomId: string): Promise<RoomContext> {
  const userId = await getAuthenticatedUserId()
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, workspaceId: true, userId: true },
  })

  if (!room) {
    throw new ForbiddenError("Room not found")
  }

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true },
  })

  if (membership) {
    if (room.userId && room.userId === userId && membership.role !== "OWNER") {
      await prisma.roomMember.update({
        where: { roomId_userId: { roomId, userId } },
        data: { role: "OWNER" },
      })
      return {
        userId,
        roomId,
        role: "OWNER",
        workspaceId: room.workspaceId ?? null,
      }
    }
    return {
      userId,
      roomId,
      role: membership.role as RoomRole,
      workspaceId: room.workspaceId ?? null,
    }
  }

  if (room.userId && room.userId === userId) {
    const created = await prisma.roomMember.create({
      data: {
        roomId,
        userId,
        role: "OWNER",
        invitedByUserId: null,
      },
      select: { role: true },
    })
    return {
      userId,
      roomId,
      role: created.role as RoomRole,
      workspaceId: room.workspaceId ?? null,
    }
  }

  throw new ForbiddenError("Room access denied")
}

export class AuthError extends Error {
  constructor() {
    super("Unauthorized")
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message)
  }
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

export function forbiddenResponse(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 })
}
