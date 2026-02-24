import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export type WorkspaceRole = "OWNER" | "MEMBER"
export interface WorkspaceContext {
  userId: string
  workspaceId: string
  role: WorkspaceRole
}

export const ACTIVE_WORKSPACE_COOKIE = "active_workspace_id"

export async function getAuthenticatedUserId(): Promise<string> {
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
