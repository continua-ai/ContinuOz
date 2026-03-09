import { NextResponse } from "next/server"

interface MockIntentRequest {
  roomId?: unknown
  message?: unknown
  agents?: Array<{
    id?: unknown
    name?: unknown
    description?: unknown
  }>
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MockIntentRequest
    const agents = Array.isArray(body.agents) ? body.agents : []

    const selectedAgentIds = agents
      .map((agent) => (typeof agent?.id === "string" ? agent.id : null))
      .filter((id): id is string => !!id)
      // 50% chance per agent
      .filter(() => Math.random() < 0.5)

    return NextResponse.json({
      selectedAgentIds,
      meta: {
        mode: "mock-probabilistic",
        probabilityPerAgent: 0.5,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid request",
      },
      { status: 400 }
    )
  }
}
