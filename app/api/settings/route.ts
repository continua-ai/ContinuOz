import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getAuthenticatedWorkspaceContext,
  AuthError,
  ForbiddenError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-helper"

export async function GET() {
  try {
    const { workspaceId } = await getAuthenticatedWorkspaceContext()
    const settings = await prisma.setting.findMany({ where: { workspaceId } })
    const result: Record<string, string> = {}
    for (const s of settings) {
      result[s.key] = s.value
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}

export async function PUT(req: Request) {
  try {
    const { workspaceId } = await getAuthenticatedWorkspaceContext()
    const { key, value } = await req.json()
    if (!key || typeof value !== "string") {
      return NextResponse.json({ error: "key and value are required" }, { status: 400 })
    }
    const setting = await prisma.setting.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      update: { value },
      create: { key, value, workspaceId },
    })
    return NextResponse.json(setting)
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponse()
    if (error instanceof ForbiddenError) return forbiddenResponse(error.message)
    throw error
  }
}
