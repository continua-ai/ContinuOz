"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useRoomStore, useAgentStore, usePeopleStore, useRoomMemberStore, useWorkspaceStore } from "@/lib/stores"

export function ManageMembersDialog({
  open,
  onOpenChange,
  roomId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomId: string
}) {
  const { rooms, updateRoomAgents } = useRoomStore()
  const { agents } = useAgentStore()
  const { members, fetchPeople } = usePeopleStore()
  const { membersByRoom, fetchRoomMembers, addRoomMember, removeRoomMember } = useRoomMemberStore()
  const { workspace } = useWorkspaceStore()

  const room = rooms.find((r) => r.id === roomId)
  const roomMembers = membersByRoom[roomId] ?? []
  const memberById = React.useMemo(
    () => new Map(roomMembers.map((m) => [m.userId, m])),
    [roomMembers]
  )

  const [selectedAgentIds, setSelectedAgentIds] = React.useState<string[]>([])
  const [savingAgents, setSavingAgents] = React.useState(false)
  const [memberActionId, setMemberActionId] = React.useState<string | null>(null)
  const [memberError, setMemberError] = React.useState<string | null>(null)

  const currentUserId = workspace?.currentUserId
  const currentMembership = currentUserId ? memberById.get(currentUserId) : undefined
  const isOwner = currentMembership?.role === "OWNER"

  React.useEffect(() => {
    if (!open) return
    fetchPeople()
    fetchRoomMembers(roomId)
    if (room?.agents) {
      setSelectedAgentIds(room.agents.map((a) => a.id))
    }
  }, [open, fetchPeople, fetchRoomMembers, roomId, room?.agents])

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  const handleSaveAgents = async () => {
    setSavingAgents(true)
    try {
      await updateRoomAgents(roomId, selectedAgentIds)
    } finally {
      setSavingAgents(false)
    }
  }

  const handleToggleMember = async (userId: string) => {
    if (!isOwner) return
    setMemberError(null)
    setMemberActionId(userId)
    try {
      if (memberById.has(userId)) {
        await removeRoomMember(roomId, userId)
      } else {
        await addRoomMember(roomId, userId)
      }
    } catch (error) {
      setMemberError(error instanceof Error ? error.message : "Failed to update member")
    } finally {
      setMemberActionId(null)
    }
  }

  const sortedUsers = React.useMemo(
    () => members.map((m) => m.user).sort((a, b) => a.name.localeCompare(b.name)),
    [members]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Members</DialogTitle>
          <DialogDescription>
            Manage agents and people who can access this room.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Agents</h3>
            {agents.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No agents available. Create an agent first.
              </div>
            ) : (
              <div className="mt-2 rounded-md border">
                {agents.map((agent) => {
                  const isSelected = selectedAgentIds.includes(agent.id)
                  return (
                    <div
                      key={agent.id}
                      className="flex items-center justify-between px-3 py-2 not-last:border-b"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: agent.color }}
                        />
                        <span className="text-sm">{agent.name}</span>
                      </div>
                      <Button
                        type="button"
                        variant={isSelected ? "outline" : "default"}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => toggleAgent(agent.id)}
                      >
                        {isSelected ? "Remove" : "Add"}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-2 flex justify-end">
              <Button onClick={handleSaveAgents} disabled={savingAgents} size="sm">
                {savingAgents ? "Saving..." : "Save agents"}
              </Button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">People</h3>
            {!isOwner && (
              <p className="mt-1 text-xs text-muted-foreground">
                Only room owners can add or remove people.
              </p>
            )}
            {sortedUsers.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No people found.
              </div>
            ) : (
              <div className="mt-2 rounded-md border">
                {sortedUsers.map((user) => {
                  const membership = memberById.get(user.id)
                  const isMember = Boolean(membership)
                  const isSelf = user.id === currentUserId
                  const isBusy = memberActionId === user.id
                  const roleLabel = membership?.role === "OWNER" ? "Owner" : "Member"
                  return (
                    <div
                      key={user.id}
                      className="flex items-center justify-between px-3 py-2 not-last:border-b"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{user.name}</span>
                          {isSelf && (
                            <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                              You
                            </span>
                          )}
                          {isMember && (
                            <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                              {roleLabel}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{user.email}</div>
                      </div>
                      <Button
                        type="button"
                        variant={isMember ? "outline" : "default"}
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!isOwner || isBusy || (isSelf && isMember)}
                        onClick={() => handleToggleMember(user.id)}
                      >
                        {isMember ? "Remove" : "Add"}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
            {memberError && (
              <p className="mt-2 text-xs text-destructive">{memberError}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
