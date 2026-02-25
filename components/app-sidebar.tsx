"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import {
  TrayIcon,
  HashIcon,
  PlusIcon,
  GearIcon,
  HouseIcon,
  SignOutIcon,
  CaretUpDownIcon,
  CheckIcon,
} from "@phosphor-icons/react"
import { AgentIcon } from "@/components/agent-icon"
import { OzLogo } from "@/components/oz-logo"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useRoomStore, useAgentStore, useNotificationStore, useWorkspaceStore } from "@/lib/stores"
import { CreateRoomDialog } from "@/components/create-room-dialog"
import { CreateAgentDialog } from "@/components/create-agent-dialog"

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session } = useSession()
  const { rooms, fetchRooms } = useRoomStore()
  const { agents, fetchAgents } = useAgentStore()
  const { unreadCount, fetchNotifications } = useNotificationStore()
  const {
    workspace,
    workspaces,
    fetchWorkspace,
    fetchWorkspaces,
    switchWorkspace,
    createWorkspace,
  } = useWorkspaceStore()
  const [roomDialogOpen, setRoomDialogOpen] = React.useState(false)
  const [agentDialogOpen, setAgentDialogOpen] = React.useState(false)
  const [createWsDialogOpen, setCreateWsDialogOpen] = React.useState(false)
  const [newWsName, setNewWsName] = React.useState("")
  const [creatingWs, setCreatingWs] = React.useState(false)
  const [createWsError, setCreateWsError] = React.useState("")
  const [switchingWsId, setSwitchingWsId] = React.useState<string | null>(null)

  React.useEffect(() => {
    fetchWorkspace()
    fetchWorkspaces()
    fetchRooms()
    fetchAgents()
    fetchNotifications()
  }, [fetchWorkspace, fetchWorkspaces, fetchRooms, fetchAgents, fetchNotifications])

  // Poll for notification updates as a fallback when the user isn't
  // in the room that generated the notification.
  React.useEffect(() => {
    const interval = setInterval(fetchNotifications, 15_000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  const handleSwitchWorkspace = async (workspaceId: string) => {
    if (switchingWsId || workspaceId === workspace?.id) return
    setSwitchingWsId(workspaceId)
    try {
      await switchWorkspace(workspaceId)
      await Promise.all([fetchRooms(), fetchAgents(), fetchNotifications()])
      router.push("/home")
      router.refresh()
    } finally {
      setSwitchingWsId(null)
    }
  }

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newWsName.trim()) return
    setCreateWsError("")
    setCreatingWs(true)
    try {
      await createWorkspace(newWsName.trim())
      await Promise.all([fetchRooms(), fetchAgents(), fetchNotifications()])
      setCreateWsDialogOpen(false)
      setNewWsName("")
      router.push("/home")
      router.refresh()
    } catch (err) {
      setCreateWsError(err instanceof Error ? err.message : "Failed to create workspace")
    } finally {
      setCreatingWs(false)
    }
  }

  return (
    <>
      <Sidebar>
        <SidebarHeader className="px-3 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-sidebar-accent focus-visible:outline-none">
                <OzLogo />
                <span className="flex-1 truncate text-sm font-semibold tracking-tight">
                  {workspace?.name ?? "ContinuOz Workspace"}
                </span>
                {switchingWsId ? (
                  <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                ) : (
                  <CaretUpDownIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {workspaces.map((ws) => (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => handleSwitchWorkspace(ws.id)}
                  disabled={switchingWsId === ws.id}
                  className="flex items-center gap-2"
                >
                  <span className="flex-1 truncate">{ws.name}</span>
                  {ws.id === workspace?.id && (
                    <CheckIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </DropdownMenuItem>
              ))}
              {workspaces.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onClick={() => setCreateWsDialogOpen(true)}>
                <PlusIcon className="mr-2 h-3.5 w-3.5" />
                Create workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarHeader>
        <SidebarContent>
          {/* Home, Settings & Inbox */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/home"}>
                    <Link href="/home">
                      <HouseIcon />
                      <span>Home</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/settings"}>
                    <Link href="/settings">
                      <GearIcon />
                      <span>Settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/inbox"}>
                    <Link href="/inbox">
                    <TrayIcon />
                      <span>Inbox</span>
                    </Link>
                  </SidebarMenuButton>
                  {unreadCount > 0 && (
                    <SidebarMenuBadge>{unreadCount}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Rooms */}
          <SidebarGroup>
            <SidebarGroupLabel>Rooms</SidebarGroupLabel>
            <SidebarGroupAction onClick={() => setRoomDialogOpen(true)} title="Create Room">
              <PlusIcon />
              <span className="sr-only">Create Room</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {rooms.map((room) => (
                  <SidebarMenuItem key={room.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === `/room/${room.id}`}
                    >
                      <Link href={`/room/${room.id}`}>
                        <HashIcon />
                        <span>{room.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Agents */}
          <SidebarGroup>
            <SidebarGroupLabel>Agents</SidebarGroupLabel>
            <SidebarGroupAction onClick={() => setAgentDialogOpen(true)} title="New Agent">
              <PlusIcon />
              <span className="sr-only">New Agent</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {agents.map((agent) => (
                  <SidebarMenuItem key={agent.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === `/agents/${agent.id}`}
                    >
                    <Link href={`/agents/${agent.id}`}>
                        <AgentIcon icon={agent.icon} />
                        <span>{agent.name}</span>
                      </Link>
                    </SidebarMenuButton>
                    <SidebarMenuBadge>
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: agent.color }}
                      />
                    </SidebarMenuBadge>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{session?.user?.name}</p>
              <p className="truncate text-xs text-muted-foreground">{session?.user?.email}</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Sign out"
            >
              <SignOutIcon className="h-4 w-4" />
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <CreateRoomDialog open={roomDialogOpen} onOpenChange={setRoomDialogOpen} />
      <CreateAgentDialog open={agentDialogOpen} onOpenChange={setAgentDialogOpen} />

      <Dialog
        open={createWsDialogOpen}
        onOpenChange={(open) => {
          setCreateWsDialogOpen(open)
          if (!open) {
            setNewWsName("")
            setCreateWsError("")
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateWorkspace}>
            <div className="py-2">
              <Input
                placeholder="Workspace name"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                autoFocus
              />
              {createWsError && (
                <p className="mt-2 text-xs text-destructive">{createWsError}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateWsDialogOpen(false)}
                disabled={creatingWs}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creatingWs || !newWsName.trim()}>
                {creatingWs ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
