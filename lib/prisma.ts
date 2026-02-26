import { PrismaClient } from "@/lib/generated/prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const globalForPrisma = globalThis as unknown as { prisma: InstanceType<typeof PrismaClient> }

function isLibsqlUrl(url: string | undefined): boolean {
  if (!url) return false
  return url.startsWith("libsql:") || url.startsWith("file:") || url.startsWith("sqlite:")
}

function resolveLibsqlUrl(): string | undefined {
  if (process.env.TURSO_DATABASE_URL) {
    return process.env.TURSO_DATABASE_URL
  }
  if (isLibsqlUrl(process.env.DATABASE_URL)) {
    return process.env.DATABASE_URL
  }
  return undefined
}

function createPrismaClient() {
  const libsqlUrl = resolveLibsqlUrl()
  if (libsqlUrl) {
    return new PrismaClient({
      adapter: new PrismaLibSql({
        url: libsqlUrl,
        authToken: process.env.TURSO_AUTH_TOKEN,
      }),
    })
  }

  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://localhost:5432/oz_workspace?schema=public"

  const pool = new Pool({ connectionString: databaseUrl })
  return new PrismaClient({
    adapter: new PrismaPg(pool),
  })
}

export const prisma = globalForPrisma.prisma || createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
