"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { useRoomStore, useAgentStore, usePeopleStore, useWorkspaceStore } from "@/lib/stores"

export function CreateRoomDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { createRoom } = useRoomStore()
  const { agents } = useAgentStore()
  const { members, fetchPeople } = usePeopleStore()
  const { workspace } = useWorkspaceStore()
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [selectedAgentIds, setSelectedAgentIds] = React.useState<string[]>([])
  const [selectedMemberIds, setSelectedMemberIds] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  const toggleMember = (id: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((memberId) => memberId !== id) : [...prev, id]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setErrorMessage(null)
    try {
      const room = await createRoom(
        name.trim(),
        description.trim(),
        selectedAgentIds,
        selectedMemberIds
      )
      onOpenChange(false)
      setName("")
      setDescription("")
      setSelectedAgentIds([])
      setSelectedMemberIds([])
      router.push(`/room/${room.id}`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create room")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    if (open) {
      fetchPeople()
    }
  }, [open, fetchPeople])

  const currentUserId = workspace?.currentUserId
  const visibleUsers = members.map((m) => m.user).filter((user) => user.id !== currentUserId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Room</DialogTitle>
          <DialogDescription>
            Create a new room for humans and agents to collaborate.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="room-name">Name</FieldLabel>
              <Input
                id="room-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Fraud Detection"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="room-desc">Description</FieldLabel>
              <p className="text-xs text-muted-foreground">Describe the project you want to build with your agents.</p>
              <Textarea
                id="room-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Build a to do list app and a marketing page for it"
              />
            </Field>
            {agents.length > 0 && (
              <Field>
                <FieldLabel>Agents</FieldLabel>
                <div className="rounded-md border">
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
              </Field>
            )}
            {visibleUsers.length > 0 && (
              <Field>
                <FieldLabel>People</FieldLabel>
                <div className="rounded-md border">
                  {visibleUsers.map((user) => {
                    const isSelected = selectedMemberIds.includes(user.id)
                    return (
                      <div
                        key={user.id}
                        className="flex items-center justify-between px-3 py-2 not-last:border-b"
                      >
                        <div>
                          <div className="text-sm">{user.name}</div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </div>
                        <Button
                          type="button"
                          variant={isSelected ? "outline" : "default"}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => toggleMember(user.id)}
                        >
                          {isSelected ? "Remove" : "Add"}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </Field>
            )}
            {errorMessage && (
              <p className="text-xs text-destructive">{errorMessage}</p>
            )}
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
