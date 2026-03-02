import { spawn } from "child_process"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { rm } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 4011
const BASE_URL = `http://127.0.0.1:${PORT}`
const DB_PATH = path.resolve(__dirname, "./test-room-membership.db")
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
  const tsconfigSnapshot = existsSync(tsconfigPath) ? readFileSync(tsconfigPath, "utf8") : null

  const { prisma } = await import("../lib/prisma")

  const [owner, member, outsider] = await prisma.$transaction([
    prisma.user.create({
      data: {
        name: "Owner",
        email: "owner-membership@example.com",
        passwordHash: "hash",
      },
    }),
    prisma.user.create({
      data: {
        name: "Member",
        email: "member@example.com",
        passwordHash: "hash",
      },
    }),
    prisma.user.create({
      data: {
        name: "Outsider",
        email: "outsider-membership@example.com",
        passwordHash: "hash",
      },
    }),
  ])

  const workspace = await prisma.workspace.create({
    data: { name: "Membership Workspace" },
  })

  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspace.id, userId: owner.id, role: "OWNER", invitedByUserId: null },
      { workspaceId: workspace.id, userId: member.id, role: "MEMBER", invitedByUserId: owner.id },
    ],
  })

  let room: { id: string }

  const devServer = spawn("npm", ["run", "dev", "--", "--port", `${PORT}`], {
    env: TEST_ENV,
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  })

  devServer.stdout.on("data", (data) => process.stdout.write(data))
  devServer.stderr.on("data", (data) => process.stderr.write(data))

  try {
    await waitForServer()

    const roomCreateResponse = await fetch(`${BASE_URL}/api/rooms`, {
      method: "POST",
      headers: {
        Cookie: `test_user_id=${owner.id}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Member Room",
        description: "Room membership test",
        memberUserIds: [member.id],
      }),
    })
    if (!roomCreateResponse.ok) {
      throw new Error(`Failed to create room via API: ${roomCreateResponse.status}`)
    }
    room = await roomCreateResponse.json()

    const ownerResponse = await fetch(`${BASE_URL}/api/messages?roomId=${room.id}`, {
      headers: { Cookie: `test_user_id=${owner.id}` },
    })
    if (!ownerResponse.ok) {
      throw new Error(`Owner could not access room: ${ownerResponse.status}`)
    }

    const peopleResponse = await fetch(`${BASE_URL}/api/workspace/people`, {
      headers: { Cookie: `test_user_id=${owner.id}` },
    })
    if (!peopleResponse.ok) {
      throw new Error(`Owner could not list workspace people: ${peopleResponse.status}`)
    }
    const people = await peopleResponse.json()
    if (!Array.isArray(people.members) || !Array.isArray(people.nonMembers)) {
      throw new Error(`Expected people list, got ${JSON.stringify(people)}`)
    }
    if (!people.nonMembers.some((u: { id: string }) => u.id === outsider.id)) {
      throw new Error("Expected outsider in non-members list")
    }

    const addWorkspaceMember = await fetch(`${BASE_URL}/api/workspace/members`, {
      method: "POST",
      headers: {
        Cookie: `test_user_id=${owner.id}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: outsider.id }),
    })
    if (addWorkspaceMember.status !== 201) {
      throw new Error(`Expected 201 for workspace add, got ${addWorkspaceMember.status}`)
    }

    const membersList = await fetch(`${BASE_URL}/api/rooms/${room.id}/members`, {
      headers: { Cookie: `test_user_id=${owner.id}` },
    })
    if (!membersList.ok) {
      throw new Error(`Owner could not list members: ${membersList.status}`)
    }
    const members = await membersList.json()
    const memberIds = new Set((members as Array<{ userId: string }>).map((m) => m.userId))
    if (!memberIds.has(owner.id) || !memberIds.has(member.id)) {
      throw new Error("Expected owner and member in initial room members")
    }

    const memberAllowedInitially = await fetch(`${BASE_URL}/api/messages?roomId=${room.id}`, {
      headers: { Cookie: `test_user_id=${member.id}` },
    })
    if (!memberAllowedInitially.ok) {
      throw new Error(`Expected member access from initial membership, got ${memberAllowedInitially.status}`)
    }

    const outsiderForbidden = await fetch(`${BASE_URL}/api/messages?roomId=${room.id}`, {
      headers: { Cookie: `test_user_id=${outsider.id}` },
    })
    if (outsiderForbidden.status !== 403) {
      throw new Error(`Expected 403 for outsider, got ${outsiderForbidden.status}`)
    }

    const addMemberResponse = await fetch(`${BASE_URL}/api/rooms/${room.id}/members`, {
      method: "POST",
      headers: {
        Cookie: `test_user_id=${owner.id}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: member.id }),
    })
    if (addMemberResponse.status !== 409) {
      throw new Error(`Expected 409 for existing member, got ${addMemberResponse.status}`)
    }

    const memberAllowed = await fetch(`${BASE_URL}/api/messages?roomId=${room.id}`, {
      headers: { Cookie: `test_user_id=${member.id}` },
    })
    if (!memberAllowed.ok) {
      throw new Error(`Room member could not access room: ${memberAllowed.status}`)
    }

    const nonOwnerAdd = await fetch(`${BASE_URL}/api/rooms/${room.id}/members`, {
      method: "POST",
      headers: {
        Cookie: `test_user_id=${member.id}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: outsider.id }),
    })
    if (nonOwnerAdd.status !== 403) {
      throw new Error(`Expected 403 for non-owner add, got ${nonOwnerAdd.status}`)
    }

    const promoteResponse = await fetch(`${BASE_URL}/api/rooms/${room.id}/members/${member.id}`, {
      method: "PATCH",
      headers: {
        Cookie: `test_user_id=${owner.id}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "OWNER" }),
    })
    if (!promoteResponse.ok) {
      throw new Error(`Expected promote OK, got ${promoteResponse.status}`)
    }

    const deleteMemberResponse = await fetch(`${BASE_URL}/api/rooms/${room.id}/members/${member.id}`, {
      method: "DELETE",
      headers: { Cookie: `test_user_id=${owner.id}` },
    })
    if (!deleteMemberResponse.ok) {
      throw new Error(`Expected delete OK, got ${deleteMemberResponse.status}`)
    }

    const ownerDeleteSelf = await fetch(`${BASE_URL}/api/rooms/${room.id}/members/${owner.id}`, {
      method: "DELETE",
      headers: { Cookie: `test_user_id=${owner.id}` },
    })
    if (ownerDeleteSelf.status !== 400) {
      throw new Error(`Expected 400 for self removal, got ${ownerDeleteSelf.status}`)
    }

    console.log("✓ test-room-membership passed")
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
  console.error("test-room-membership failed:", error)
  process.exit(1)
})
