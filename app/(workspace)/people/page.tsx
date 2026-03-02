"use client"

import * as React from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { usePeopleStore, useWorkspaceStore } from "@/lib/stores"

export default function PeoplePage() {
  const { members, nonMembers, fetchPeople, addWorkspaceMember } = usePeopleStore()
  const { workspace } = useWorkspaceStore()

  React.useEffect(() => {
    fetchPeople()
  }, [fetchPeople])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4">
        <h1 className="text-sm font-semibold">People</h1>
      </header>
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-4">
          <div>
            <h2 className="text-xs font-semibold uppercase text-muted-foreground">Workspace members</h2>
            <div className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((member) => (
                <Card key={member.userId}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{member.user.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    <div>{member.user.email}</div>
                    <div>Role: {member.role}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase text-muted-foreground">Add people</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Add people to the workspace so they can join rooms.
            </p>
            <div className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-3">
              {nonMembers.map((user) => (
                <Card key={user.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{user.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    <div>{user.email}</div>
                    <div>Joined {new Date(user.createdAt).toLocaleDateString()}</div>
                    <Button
                      size="sm"
                      className="mt-2"
                      disabled={workspace?.role !== "OWNER"}
                      onClick={() => addWorkspaceMember(user.id)}
                    >
                      Add to workspace
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
