import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export type WorkspaceRole = "OWNER" | "MEMBER"
export interface WorkspaceContext {
  userId: string
  workspaceId: string
  role: WorkspaceRole
}

export async function getAuthenticatedUserId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new AuthError()
  }
  return session.user.id
}

export async function getAuthenticatedWorkspaceContext(): Promise<WorkspaceContext> {
  const userId = await getAuthenticatedUserId()
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    select: { workspaceId: true, role: true },
    orderBy: { createdAt: "desc" },
  })
  if (!membership) {
    throw new ForbiddenError("No workspace membership")
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
