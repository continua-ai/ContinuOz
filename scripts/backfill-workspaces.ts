import "dotenv/config"

function isLibsqlUrl(url: string | undefined): boolean {
  if (!url) return false
  return url.startsWith("libsql:") || url.startsWith("file:") || url.startsWith("sqlite:")
}

if (!process.env.TURSO_DATABASE_URL && isLibsqlUrl(process.env.DATABASE_URL)) {
  process.env.TURSO_DATABASE_URL = process.env.DATABASE_URL
}

async function backfillWorkspaces() {
  const { prisma } = await import("@/lib/prisma")
  const users = await prisma.user.findMany({
    select: { id: true, name: true },
  })

  for (const user of users) {
    let membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      select: { workspaceId: true },
      orderBy: { createdAt: "asc" },
    })

    if (!membership) {
      const workspace = await prisma.workspace.create({
        data: { name: `${user.name}'s Workspace` },
        select: { id: true },
      })
      await prisma.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "OWNER",
          invitedByUserId: null,
        },
      })
      membership = { workspaceId: workspace.id }
    }

    const workspaceId = membership.workspaceId
    await prisma.room.updateMany({
      where: { userId: user.id, workspaceId: null },
      data: { workspaceId },
    })
    await prisma.agent.updateMany({
      where: { userId: user.id, workspaceId: null },
      data: { workspaceId },
    })
    await prisma.setting.updateMany({
      where: { legacyUserId: user.id, workspaceId: null },
      data: { workspaceId },
    })
  }

  console.log(`Workspace backfill completed for ${users.length} users.`)
}

backfillWorkspaces()
  .catch((error) => {
    console.error("Workspace backfill failed:", error)
    process.exit(1)
  })
  .finally(async () => {
    const { prisma } = await import("@/lib/prisma")
    await prisma.$disconnect()
  })
