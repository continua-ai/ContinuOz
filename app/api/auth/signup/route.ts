import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { seedNewAccount } from "@/lib/seed-account"

export async function POST(request: Request) {
  try {
    const { name, email, password, inviteToken } = await request.json()

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      )
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const invite =
      typeof inviteToken === "string" && inviteToken.length > 0
        ? await prisma.workspaceInvite.findUnique({
            where: { id: inviteToken },
            select: {
              id: true,
              workspaceId: true,
              role: true,
              createdByUserId: true,
              acceptedAt: true,
              expiresAt: true,
            },
          })
        : null

    if (inviteToken && !invite) {
      return NextResponse.json({ error: "Invalid invite link" }, { status: 400 })
    }
    if (invite?.acceptedAt) {
      return NextResponse.json({ error: "Invite link has already been used" }, { status: 400 })
    }
    if (invite?.expiresAt && invite.expiresAt < new Date()) {
      return NextResponse.json({ error: "Invite link has expired" }, { status: 400 })
    }

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { name, email, passwordHash },
      })

      if (invite) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: invite.workspaceId,
            userId: createdUser.id,
            role: invite.role,
            invitedByUserId: invite.createdByUserId,
          },
        })
        await tx.workspaceInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        })
        return createdUser
      }

      const workspace = await tx.workspace.create({
        data: {
          name: `${name}'s Workspace`,
        },
      })
      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: createdUser.id,
          role: "OWNER",
          invitedByUserId: null,
        },
      })
      return createdUser
    })

    // Seed starter agents and example room only for newly created owner workspace.
    if (!invite) {
      try {
        const ownerMembership = await prisma.workspaceMember.findFirst({
          where: { userId: user.id, role: "OWNER" },
          select: { workspaceId: true },
          orderBy: { createdAt: "asc" },
        })
        if (ownerMembership) {
          await seedNewAccount(user.id, ownerMembership.workspaceId)
        }
      } catch (seedError) {
        console.error("Failed to seed new account:", seedError)
      }
    }

    return NextResponse.json(
      { id: user.id, name: user.name, email: user.email },
      { status: 201 }
    )
  } catch (error) {
    console.error("POST /api/auth/signup error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
