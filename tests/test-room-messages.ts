import { spawn } from "child_process"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { rm } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 4010
const BASE_URL = `http://127.0.0.1:${PORT}`
const DB_PATH = path.resolve(__dirname, "./test-room-messages.db")
const DB_URL = `file:${DB_PATH}`

const TEST_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "test",
  TEST_AUTH_MODE: "true",
  TURSO_DATABASE_URL: DB_URL,
  DATABASE_URL: DB_URL,
}

process.env.TEST_AUTH_MODE = "true"
process.env.TURSO_DATABASE_URL = DB_URL
process.env.DATABASE_URL = DB_URL

async function waitForServer() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/login`)
      if (res.ok) return
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error("Server did not start in time")
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: TEST_ENV,
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
    })
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`))
      }
    })
  })
}

async function main() {
  if (existsSync(DB_PATH)) {
    await rm(DB_PATH)
  }

  await runCommand("npx", ["prisma", "generate"])
  await runCommand("npx", ["prisma", "db", "push"])

  const tsconfigPath = path.resolve(__dirname, "../tsconfig.json")
  const tsconfigExists = existsSync(tsconfigPath)
  const tsconfigSnapshot = tsconfigExists ? readFileSync(tsconfigPath, "utf8") : null

  const { prisma } = await import("../lib/prisma")

  const [owner, outsider] = await prisma.$transaction([
    prisma.user.create({
      data: {
        name: "Owner",
        email: "owner@example.com",
        passwordHash: "hash",
      },
    }),
    prisma.user.create({
      data: {
        name: "Outsider",
        email: "outsider@example.com",
        passwordHash: "hash",
      },
    }),
  ])

  const workspace = await prisma.workspace.create({
    data: { name: "Test Workspace" },
  })

  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: owner.id,
      role: "OWNER",
      invitedByUserId: null,
    },
  })

  const room = await prisma.room.create({
    data: {
      name: "Test Room",
      description: "Room for tests",
      userId: owner.id,
      workspaceId: workspace.id,
    },
  })

  const devServer = spawn("npm", ["run", "dev", "--", "--port", `${PORT}`], {
    env: TEST_ENV,
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  })

  devServer.stdout.on("data", (data) => process.stdout.write(data))
  devServer.stderr.on("data", (data) => process.stderr.write(data))

  try {
    await waitForServer()

    const createResponse = await fetch(`${BASE_URL}/api/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `test_user_id=${owner.id}`,
      },
      body: JSON.stringify({
        roomId: room.id,
        content: "Hello from owner",
      }),
    })

    if (!createResponse.ok) {
      throw new Error(`POST /api/messages failed: ${createResponse.status}`)
    }

    const listResponse = await fetch(`${BASE_URL}/api/messages?roomId=${room.id}`, {
      headers: {
        Cookie: `test_user_id=${owner.id}`,
      },
    })

    if (!listResponse.ok) {
      throw new Error(`GET /api/messages failed: ${listResponse.status}`)
    }

    const listBody = await listResponse.json()
    const messages = listBody.messages ?? []
    if (messages.length !== 1 || messages[0]?.content !== "Hello from owner") {
      throw new Error("GET /api/messages did not return expected message")
    }

    const forbiddenResponse = await fetch(`${BASE_URL}/api/messages?roomId=${room.id}`, {
      headers: {
        Cookie: `test_user_id=${outsider.id}`,
      },
    })

    if (forbiddenResponse.status !== 403) {
      throw new Error(`Expected 403 for non-member, got ${forbiddenResponse.status}`)
    }

    console.log("✓ test-room-messages passed")
  } finally {
    devServer.kill("SIGTERM")
    await prisma.$disconnect()
    if (tsconfigSnapshot !== null) {
      writeFileSync(tsconfigPath, tsconfigSnapshot)
    }
    if (existsSync(DB_PATH)) {
      await rm(DB_PATH)
    }
  }
}

main().catch((error) => {
  console.error("test-room-messages failed:", error)
  process.exit(1)
})
