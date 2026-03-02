import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import type {
  Room,
  Agent,
  Message,
  Artifact,
  Task,
  Notification,
  Workspace,
  WorkspaceMember,
  WorkspaceInvite,
  User,
  RoomMember,
} from "@/lib/types"

// ─── Room Store ────────────────────────────────────────────

const ROOM_ORDER_KEY = "room_order"

function readRoomOrder(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(ROOM_ORDER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []
  } catch {
    return []
  }
}

function writeRoomOrder(order: string[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(ROOM_ORDER_KEY, JSON.stringify(order))
}

function applyRoomOrder(rooms: Room[], order: string[]): Room[] {
  if (order.length === 0) return rooms
  const byId = new Map(rooms.map((room) => [room.id, room]))
  const ordered: Room[] = []
  for (const id of order) {
    const room = byId.get(id)
    if (room) ordered.push(room)
    byId.delete(id)
  }
  return [...ordered, ...byId.values()]
}

interface RoomStore {
  rooms: Room[]
  roomOrder: string[]
  activeRoomId: string | null
  setActiveRoom: (id: string | null) => void
  setRoomOrder: (order: string[]) => void
  fetchRooms: () => Promise<void>
  refreshRoom: (roomId: string) => Promise<void>
  createRoom: (
    name: string,
    description?: string,
    agentIds?: string[],
    memberUserIds?: string[]
  ) => Promise<Room>
  updateRoomAgents: (roomId: string, agentIds: string[]) => Promise<Room>
  updateRoomDescription: (roomId: string, description: string) => Promise<Room>
  deleteRoom: (id: string) => Promise<void>
}

export const useRoomStore = create<RoomStore>((set) => ({
  rooms: [],
  roomOrder: [],
  activeRoomId: null,
  setActiveRoom: (id) => set({ activeRoomId: id }),
  setRoomOrder: (order) => {
    writeRoomOrder(order)
    set((s) => ({
      roomOrder: order,
      rooms: applyRoomOrder(s.rooms, order),
    }))
  },
  fetchRooms: async () => {
    const res = await fetch("/api/rooms")
    const rooms = await res.json()
    const order = readRoomOrder()
    const orderedRooms = applyRoomOrder(rooms, order)
    const nextOrder = orderedRooms.map((room: Room) => room.id)
    writeRoomOrder(nextOrder)
    set({ rooms: orderedRooms, roomOrder: nextOrder })
  },
  refreshRoom: async (roomId) => {
    const res = await fetch(`/api/rooms/${roomId}`)
    if (!res.ok) return
    const room = await res.json()
    set((s) => ({ rooms: s.rooms.map((r) => (r.id === roomId ? room : r)) }))
  },
  createRoom: async (name, description = "", agentIds = [], memberUserIds = []) => {
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, agentIds, memberUserIds }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to create room" }))
      throw new Error(err.error ?? `Failed to create room (${res.status})`)
    }
    const room = await res.json()
    set((s) => {
      const exists = s.rooms.some((r) => r.id === room.id)
      const rooms = exists ? s.rooms : [...s.rooms, room]
      const order = exists ? s.roomOrder : [...s.roomOrder, room.id]
      writeRoomOrder(order)
      return { rooms, roomOrder: order }
    })
    return room
  },
  updateRoomAgents: async (roomId, agentIds) => {
    const res = await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentIds }),
    })
    const room = await res.json()
    set((s) => ({ rooms: s.rooms.map((r) => (r.id === roomId ? room : r)) }))
    return room
  },
  updateRoomDescription: async (roomId, description) => {
    const res = await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    })
    const room = await res.json()
    set((s) => ({ rooms: s.rooms.map((r) => (r.id === roomId ? room : r)) }))
    return room
  },
  deleteRoom: async (id) => {
    await fetch(`/api/rooms/${id}`, { method: "DELETE" })
    set((s) => {
      const rooms = s.rooms.filter((r) => r.id !== id)
      const order = s.roomOrder.filter((roomId) => roomId !== id)
      writeRoomOrder(order)
      return {
        rooms,
        roomOrder: order,
        activeRoomId: s.activeRoomId === id ? null : s.activeRoomId,
      }
    })
  },
}))

// ─── Workspace Store ──────────────────────────────────────

interface WorkspaceStore {
  workspace: Workspace | null
  workspaces: Workspace[]
  members: WorkspaceMember[]
  invites: WorkspaceInvite[]
  fetchWorkspace: () => Promise<void>
  fetchWorkspaces: () => Promise<void>
  switchWorkspace: (workspaceId: string) => Promise<void>
  createWorkspace: (name: string) => Promise<Workspace>
  fetchMembers: () => Promise<void>
  fetchInvites: () => Promise<void>
  createInvite: (expiresInDays?: number) => Promise<WorkspaceInvite>
  revokeInvite: (inviteId: string) => Promise<void>
  removeMember: (userId: string) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspace: null,
  workspaces: [],
  members: [],
  invites: [],
  fetchWorkspace: async () => {
    const res = await fetch("/api/workspace")
    if (!res.ok) return
    const workspace = await res.json()
    set({ workspace })
  },
  fetchWorkspaces: async () => {
    const res = await fetch("/api/workspaces")
    if (!res.ok) return
    const workspaces = await res.json()
    set({ workspaces })
  },
  switchWorkspace: async (workspaceId) => {
    const res = await fetch("/api/workspace/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to switch workspace" }))
      throw new Error(err.error ?? "Failed to switch workspace")
    }
    const workspace = await res.json()
    set({ workspace, members: [], invites: [] })
  },
  createWorkspace: async (name) => {
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to create workspace" }))
      throw new Error(err.error ?? "Failed to create workspace")
    }
    const workspace = await res.json()
    set((s) => ({
      workspace,
      workspaces: [...s.workspaces, workspace],
      members: [],
      invites: [],
    }))
    return workspace
  },
  fetchMembers: async () => {
    const res = await fetch("/api/workspace/members")
    if (!res.ok) return
    const members = await res.json()
    set({ members })
  },
  fetchInvites: async () => {
    const res = await fetch("/api/workspace/invites")
    if (!res.ok) return
    const invites = await res.json()
    set({ invites })
  },
  createInvite: async (expiresInDays) => {
    const res = await fetch("/api/workspace/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        Number.isFinite(expiresInDays)
          ? { expiresInDays }
          : {}
      ),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to create invite" }))
      throw new Error(err.error ?? "Failed to create invite")
    }
    const invite = await res.json()
    set((s) => ({ invites: [invite, ...s.invites] }))
    return invite
  },
  revokeInvite: async (inviteId) => {
    const res = await fetch(`/api/workspace/invites/${inviteId}`, { method: "DELETE" })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to revoke invite" }))
      throw new Error(err.error ?? "Failed to revoke invite")
    }
    set((s) => ({ invites: s.invites.filter((i) => i.id !== inviteId) }))
  },
  removeMember: async (userId) => {
    const res = await fetch(`/api/workspace/members/${userId}`, { method: "DELETE" })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to remove member" }))
      throw new Error(err.error ?? "Failed to remove member")
    }
    set({ members: get().members.filter((m) => m.userId !== userId) })
  },
}))

// ─── People Store ──────────────────────────────────────────

interface PeopleStore {
  members: WorkspaceMember[]
  nonMembers: User[]
  fetchPeople: () => Promise<void>
  addWorkspaceMember: (userId: string) => Promise<void>
}

export const usePeopleStore = create<PeopleStore>((set) => ({
  members: [],
  nonMembers: [],
  fetchPeople: async () => {
    const res = await fetch("/api/workspace/people")
    if (!res.ok) return
    const data = await res.json()
    set({ members: data.members ?? [], nonMembers: data.nonMembers ?? [] })
  },
  addWorkspaceMember: async (userId) => {
    const res = await fetch("/api/workspace/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to add member" }))
      throw new Error(err.error ?? "Failed to add member")
    }
    const member = await res.json()
    set((s) => ({
      members: [...s.members, member],
      nonMembers: s.nonMembers.filter((u) => u.id !== userId),
    }))
  },
}))

// ─── Room Members Store ─────────────────────────────────────

interface RoomMemberStore {
  membersByRoom: Record<string, RoomMember[]>
  fetchRoomMembers: (roomId: string) => Promise<void>
  addRoomMember: (roomId: string, userId: string) => Promise<void>
  removeRoomMember: (roomId: string, userId: string) => Promise<void>
}

export const useRoomMemberStore = create<RoomMemberStore>((set) => ({
  membersByRoom: {},
  fetchRoomMembers: async (roomId) => {
    const res = await fetch(`/api/rooms/${roomId}/members`)
    if (!res.ok) return
    const members = await res.json()
    set((s) => ({ membersByRoom: { ...s.membersByRoom, [roomId]: members } }))
  },
  addRoomMember: async (roomId, userId) => {
    const res = await fetch(`/api/rooms/${roomId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to add member" }))
      throw new Error(err.error ?? "Failed to add member")
    }
    const member = await res.json()
    set((s) => {
      const existing = s.membersByRoom[roomId] || []
      const hasMember = existing.some((m) => m.userId === member.userId)
      return {
        membersByRoom: {
          ...s.membersByRoom,
          [roomId]: hasMember ? existing : [...existing, member],
        },
      }
    })
  },
  removeRoomMember: async (roomId, userId) => {
    const res = await fetch(`/api/rooms/${roomId}/members/${userId}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to remove member" }))
      throw new Error(err.error ?? "Failed to remove member")
    }
    set((s) => ({
      membersByRoom: {
        ...s.membersByRoom,
        [roomId]: (s.membersByRoom[roomId] || []).filter((m) => m.userId !== userId),
      },
    }))
  },
}))

// ─── Agent Store ───────────────────────────────────────────

interface AgentStore {
  agents: Agent[]
  fetchAgents: () => Promise<void>
  createAgent: (data: Partial<Agent>) => Promise<Agent>
  updateAgent: (id: string, data: Partial<Agent>) => Promise<Agent>
  deleteAgent: (id: string) => Promise<void>
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: [],
  fetchAgents: async () => {
    const res = await fetch("/api/agents")
    const agents = await res.json()
    set({ agents })
  },
  createAgent: async (data) => {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    const agent = await res.json()
    set((s) => ({
      agents: s.agents.some((a) => a.id === agent.id) ? s.agents : [...s.agents, agent],
    }))
    return agent
  },
  updateAgent: async (id, data) => {
    const res = await fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    const agent = await res.json()
    set((s) => ({ agents: s.agents.map((a) => (a.id === id ? agent : a)) }))
    return agent
  },
  deleteAgent: async (id) => {
    await fetch(`/api/agents/${id}`, { method: "DELETE" })
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }))
  },
}))

// ─── Message Store ─────────────────────────────────────────

interface MessageStore {
  messagesByRoom: Record<string, Message[]>
  hasMoreByRoom: Record<string, boolean>
  cursorByRoom: Record<string, string | null>
  fetchMessages: (roomId: string) => Promise<void>
  fetchOlderMessages: (roomId: string) => Promise<void>
  sendMessage: (roomId: string, content: string) => Promise<Message>
  appendMessage: (roomId: string, message: Message) => void
}

export const useMessageStore = create<MessageStore>()(immer((set, get) => ({
  messagesByRoom: {},
  hasMoreByRoom: {},
  cursorByRoom: {},
  fetchMessages: async (roomId) => {
    const res = await fetch(`/api/messages?roomId=${roomId}&limit=50`)
    const data = await res.json()
    const messages: Message[] = Array.isArray(data) ? data : data.messages
    const hasMore: boolean = Array.isArray(data) ? false : (data.hasMore ?? false)
    const nextCursor: string | null = Array.isArray(data) ? null : (data.nextCursor ?? null)
    set((s) => {
      s.messagesByRoom[roomId] = messages
      s.hasMoreByRoom[roomId] = hasMore
      s.cursorByRoom[roomId] = nextCursor
    })
  },
  fetchOlderMessages: async (roomId) => {
    const cursor = get().cursorByRoom[roomId]
    if (!cursor) return
    const res = await fetch(`/api/messages?roomId=${roomId}&limit=50&cursor=${cursor}`)
    const data = await res.json()
    const olderMessages: Message[] = Array.isArray(data) ? data : data.messages
    const hasMore: boolean = Array.isArray(data) ? false : (data.hasMore ?? false)
    const nextCursor: string | null = Array.isArray(data) ? null : (data.nextCursor ?? null)
    set((s) => {
      const existing = s.messagesByRoom[roomId] || []
      const existingIds = new Set(existing.map((m) => m.id))
      const newMessages = olderMessages.filter((m) => !existingIds.has(m.id))
      s.messagesByRoom[roomId] = [...newMessages, ...existing]
      s.hasMoreByRoom[roomId] = hasMore
      s.cursorByRoom[roomId] = nextCursor
    })
  },
  sendMessage: async (roomId, content) => {
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, content, authorType: "human" }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }))
      throw new Error(err.error ?? `Failed to send message (${res.status})`)
    }
    const message = await res.json()
    set((s) => {
      const existing = s.messagesByRoom[roomId] || []
      if (!existing.some((m) => m.id === message.id)) {
        if (!s.messagesByRoom[roomId]) s.messagesByRoom[roomId] = []
        s.messagesByRoom[roomId].push(message)
      }
    })
    return message
  },
  appendMessage: (roomId, message) =>
    set((s) => {
      if (!s.messagesByRoom[roomId]) s.messagesByRoom[roomId] = []
      const existing = s.messagesByRoom[roomId]
      const idx = existing.findIndex((m) => m.id === message.id)
      if (idx !== -1) {
        // Update in-place
        Object.assign(existing[idx], message)
      } else {
        existing.push(message)
      }
    }),
})))

// ─── Artifact Store ────────────────────────────────────────

interface ArtifactStore {
  artifactsByRoom: Record<string, Artifact[]>
  fetchArtifacts: (roomId: string) => Promise<void>
  createArtifact: (data: Partial<Artifact> & { roomId: string; type: string; title: string }) => Promise<Artifact>
}

export const useArtifactStore = create<ArtifactStore>((set) => ({
  artifactsByRoom: {},
  fetchArtifacts: async (roomId) => {
    const res = await fetch(`/api/artifacts?roomId=${roomId}`)
    const artifacts = await res.json()
    set((s) => ({ artifactsByRoom: { ...s.artifactsByRoom, [roomId]: artifacts } }))
  },
  createArtifact: async (data) => {
    const res = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    const artifact = await res.json()
    set((s) => {
      const existing = s.artifactsByRoom[data.roomId] || []
      if (existing.some((a) => a.id === artifact.id)) return s
      return { artifactsByRoom: { ...s.artifactsByRoom, [data.roomId]: [...existing, artifact] } }
    })
    return artifact
  },
}))

// ─── Task Store ────────────────────────────────────────────

interface TaskStore {
  tasksByRoom: Record<string, Task[]>
  fetchTasks: (roomId: string) => Promise<void>
  createTask: (data: { roomId: string; title: string; description?: string; status?: string; priority?: string; assigneeId?: string }) => Promise<Task>
  updateTask: (id: string, data: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "assigneeId">>) => Promise<Task>
  deleteTask: (id: string, roomId: string) => Promise<void>
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasksByRoom: {},
  fetchTasks: async (roomId) => {
    const res = await fetch(`/api/tasks?roomId=${roomId}`)
    if (!res.ok) return
    const tasks = await res.json()
    if (!Array.isArray(tasks)) return
    set((s) => ({ tasksByRoom: { ...s.tasksByRoom, [roomId]: tasks } }))
  },
  createTask: async (data) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    const task = await res.json()
    set((s) => {
      const existing = s.tasksByRoom[data.roomId] || []
      if (existing.some((t) => t.id === task.id)) return s
      return {
        tasksByRoom: {
          ...s.tasksByRoom,
          [data.roomId]: [...existing, task],
        },
      }
    })
    return task
  },
  updateTask: async (id, data) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    const task = await res.json()
    set((s) => {
      const updated: Record<string, Task[]> = {}
      for (const [roomId, tasks] of Object.entries(s.tasksByRoom)) {
        updated[roomId] = tasks.map((t) => (t.id === id ? task : t))
      }
      return { tasksByRoom: updated }
    })
    return task
  },
  deleteTask: async (id, roomId) => {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" })
    set((s) => ({
      tasksByRoom: {
        ...s.tasksByRoom,
        [roomId]: (s.tasksByRoom[roomId] || []).filter((t) => t.id !== id),
      },
    }))
  },
}))

// ─── Notification Store ────────────────────────────────────

interface NotificationStore {
  notifications: Notification[]
  unreadCount: number
  fetchNotifications: () => Promise<void>
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  deleteNotification: (id: string) => Promise<void>
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  unreadCount: 0,
  fetchNotifications: async () => {
    const res = await fetch("/api/notifications")
    const notifications = await res.json()
    set({
      notifications,
      unreadCount: notifications.filter((n: Notification) => !n.read).length,
    })
  },
  markAsRead: async (id) => {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" })
    set((s) => {
      const notifications = s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      )
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      }
    })
  },
  markAllAsRead: async () => {
    await fetch("/api/notifications/read-all", { method: "POST" })
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }))
  },
  deleteNotification: async (id) => {
    await fetch(`/api/notifications/${id}`, { method: "DELETE" })
    set((s) => {
      const notifications = s.notifications.filter((n) => n.id !== id)
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      }
    })
  },
}))

// ─── Settings Store ────────────────────────────────────────

interface SettingsStore {
  settings: Record<string, string>
  fetchSettings: () => Promise<void>
  updateSetting: (key: string, value: string) => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: {},
  fetchSettings: async () => {
    const res = await fetch("/api/settings")
    const settings = await res.json()
    set({ settings })
  },
  updateSetting: async (key, value) => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    })
    set((s) => ({ settings: { ...s.settings, [key]: value } }))
  },
}))
