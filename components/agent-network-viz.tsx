"use client"

import * as React from "react"

interface AgentNode {
  id: string
  label: string
  x: number
  y: number
  color: string
  radius: number
}

interface Edge {
  from: number
  to: number
}

interface Particle {
  edgeIndex: number
  t: number
  speed: number
  forward: boolean
  color: string
  size: number
}

// Lifecycle state for sub-agent visibility (index 0 = team-lead is always visible)
interface AgentLifecycle {
  opacity: number          // 0 = hidden, 1 = fully visible
  active: boolean          // currently spinning up or staying alive
  nextToggle: number       // timestamp when state flips
}

// Smoothly interpolated position for each agent
interface AgentPosition {
  x: number
  y: number
  targetX: number
  targetY: number
}

const AGENTS: Omit<AgentNode, "x" | "y" | "radius">[] = [
  { id: "team-lead", label: "team-lead", color: "#F97316" },
  { id: "tech-lead", label: "tech-lead", color: "#06B6D4" },
  { id: "worker-1", label: "worker", color: "#F59E0B" },
  { id: "worker-2", label: "worker", color: "#F59E0B" },
  { id: "design-lead", label: "design-lead", color: "#EC4899" },
  { id: "marketing-lead", label: "marketing-lead", color: "#10B981" },
  { id: "product-lead", label: "product-lead", color: "#3B82F6" },
]

// Hub center (normalized 0-1)
const HUB_X = 0.50
const HUB_Y = 0.48
// Radii for the orbit ellipse (normalized)
const ORBIT_RX = 0.34
const ORBIT_RY = 0.36

// Connections: team-lead connects to everyone; some peer connections
const EDGES: Edge[] = [
  { from: 0, to: 1 }, // team-lead ↔ tech-lead
  { from: 0, to: 2 }, // team-lead ↔ worker-1
  { from: 0, to: 3 }, // team-lead ↔ worker-2
  { from: 0, to: 4 }, // team-lead ↔ design-lead
  { from: 0, to: 5 }, // team-lead ↔ marketing-lead
  { from: 0, to: 6 }, // team-lead ↔ product-lead
  { from: 1, to: 2 }, // tech-lead ↔ worker-1
  { from: 1, to: 3 }, // tech-lead ↔ worker-2
  { from: 4, to: 6 }, // design-lead ↔ product-lead
  { from: 5, to: 6 }, // marketing-lead ↔ product-lead
]

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function AgentNetworkViz({ className }: { className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animationId: number
    let particles: Particle[] = []
    let lastSpawn = 0
    const dpr = window.devicePixelRatio || 1

    // Initialise lifecycle for each sub-agent (index 0 is always-on)
    const lifecycles: AgentLifecycle[] = AGENTS.map((_, i) => ({
      opacity: i === 0 ? 1 : Math.random() > 0.3 ? 1 : 0,
      active: i === 0 ? true : Math.random() > 0.3,
      nextToggle: i === 0 ? Infinity : performance.now() + 2000 + Math.random() * 6000,
    }))
    const FADE_SPEED = 0.03 // opacity change per frame (~0.5 s fade at 60 fps)
    const POS_LERP = 0.04   // position smoothing per frame

    // Mutable positions (pixel coords, updated every frame)
    const positions: AgentPosition[] = AGENTS.map(() => ({ x: 0, y: 0, targetX: 0, targetY: 0 }))
    let layoutDirty = true // force initial target computation
    let firstFrame = true

    function resize() {
      const rect = container!.getBoundingClientRect()
      canvas!.width = rect.width * dpr
      canvas!.height = rect.height * dpr
      canvas!.style.width = `${rect.width}px`
      canvas!.style.height = `${rect.height}px`
      layoutDirty = true
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    /** Recompute target positions: active sub-agents distribute evenly around the hub. */
    function recomputeTargets() {
      const w = canvas!.width / dpr
      const h = canvas!.height / dpr
      const padX = 80
      const padY = 50
      const innerW = w - padX * 2
      const innerH = h - padY * 2

      const cx = padX + HUB_X * innerW
      const cy = padY + HUB_Y * innerH

      // Hub always at center
      positions[0].targetX = cx
      positions[0].targetY = cy

      // Collect indices of active (or fading-in) sub-agents
      const activeIndices: number[] = []
      for (let i = 1; i < AGENTS.length; i++) {
        if (lifecycles[i].active || lifecycles[i].opacity > 0) activeIndices.push(i)
      }

      // Distribute evenly around an ellipse, starting from top (-π/2)
      const count = activeIndices.length
      for (let slot = 0; slot < count; slot++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * slot) / count
        const idx = activeIndices[slot]
        positions[idx].targetX = cx + Math.cos(angle) * ORBIT_RX * innerW
        positions[idx].targetY = cy + Math.sin(angle) * ORBIT_RY * innerH
      }

      // Inactive & fully hidden agents: collapse toward hub
      for (let i = 1; i < AGENTS.length; i++) {
        if (!lifecycles[i].active && lifecycles[i].opacity <= 0) {
          positions[i].targetX = cx
          positions[i].targetY = cy
        }
      }
    }

    function getNodes(): AgentNode[] {
      return AGENTS.map((a, i) => ({
        ...a,
        x: positions[i].x,
        y: positions[i].y,
        radius: i === 0 ? 22 : 16,
      }))
    }

    function spawnParticle(nodes: AgentNode[]) {
      const edgeIndex = Math.floor(Math.random() * EDGES.length)
      const edge = EDGES[edgeIndex]
      const forward = Math.random() > 0.5
      const fromNode = nodes[forward ? edge.from : edge.to]
      particles.push({
        edgeIndex,
        t: 0,
        speed: 0.003 + Math.random() * 0.006,
        forward,
        color: fromNode.color,
        size: 2 + Math.random() * 2,
      })
    }

    function draw(timestamp: number) {
      const w = canvas!.width / dpr
      const h = canvas!.height / dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx!.clearRect(0, 0, w, h)

      // Update agent lifecycles (spin up / spin down)
      for (let i = 1; i < lifecycles.length; i++) {
        const lc = lifecycles[i]
        if (timestamp >= lc.nextToggle) {
          lc.active = !lc.active
          layoutDirty = true
          // Active agents stay 4-10 s, inactive agents stay hidden 2-5 s
          lc.nextToggle = timestamp + (lc.active
            ? 4000 + Math.random() * 6000
            : 2000 + Math.random() * 3000)
        }
        // Fade towards target
        if (lc.active && lc.opacity < 1) lc.opacity = Math.min(1, lc.opacity + FADE_SPEED)
        if (!lc.active && lc.opacity > 0) lc.opacity = Math.max(0, lc.opacity - FADE_SPEED)
      }

      // Recompute radial targets when the active set changes or canvas resizes
      if (layoutDirty) {
        recomputeTargets()
        layoutDirty = false
      }

      // Smoothly move current positions toward targets (snap on first frame)
      for (const p of positions) {
        if (firstFrame) {
          p.x = p.targetX
          p.y = p.targetY
        } else {
          p.x = lerp(p.x, p.targetX, POS_LERP)
          p.y = lerp(p.y, p.targetY, POS_LERP)
        }
      }
      firstFrame = false

      const nodes = getNodes()

      // Spawn particles periodically (only on edges where both nodes are visible)
      if (timestamp - lastSpawn > 120) {
        const visibleEdges = EDGES
          .map((e, i) => ({ e, i }))
          .filter(({ e }) => lifecycles[e.from].opacity > 0.3 && lifecycles[e.to].opacity > 0.3)
        if (visibleEdges.length > 0) {
          const pick = visibleEdges[Math.floor(Math.random() * visibleEdges.length)]
          const forward = Math.random() > 0.5
          const fromNode = nodes[forward ? pick.e.from : pick.e.to]
          particles.push({
            edgeIndex: pick.i,
            t: 0,
            speed: 0.003 + Math.random() * 0.006,
            forward,
            color: fromNode.color,
            size: 2 + Math.random() * 2,
          })
          if (Math.random() > 0.5 && visibleEdges.length > 1) {
            const pick2 = visibleEdges[Math.floor(Math.random() * visibleEdges.length)]
            const fwd2 = Math.random() > 0.5
            const from2 = nodes[fwd2 ? pick2.e.from : pick2.e.to]
            particles.push({
              edgeIndex: pick2.i,
              t: 0,
              speed: 0.003 + Math.random() * 0.006,
              forward: fwd2,
              color: from2.color,
              size: 2 + Math.random() * 2,
            })
          }
        }
        lastSpawn = timestamp
      }

      const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

      // Draw edges (dashed, alpha scaled by both endpoints' opacity)
      for (const edge of EDGES) {
        const opA = lifecycles[edge.from].opacity
        const opB = lifecycles[edge.to].opacity
        const edgeAlpha = Math.min(opA, opB)
        if (edgeAlpha < 0.01) continue

        const a = nodes[edge.from]
        const b = nodes[edge.to]
        const [r1, g1, b1] = hexToRgb(a.color)
        const [r2, g2, b2] = hexToRgb(b.color)

        const grad = ctx!.createLinearGradient(a.x, a.y, b.x, b.y)
        grad.addColorStop(0, `rgba(${r1},${g1},${b1},${0.12 * edgeAlpha})`)
        grad.addColorStop(1, `rgba(${r2},${g2},${b2},${0.12 * edgeAlpha})`)

        ctx!.beginPath()
        ctx!.setLineDash([4, 4])
        ctx!.moveTo(a.x, a.y)
        ctx!.lineTo(b.x, b.y)
        ctx!.strokeStyle = grad
        ctx!.lineWidth = 1
        ctx!.stroke()
        ctx!.setLineDash([])
      }

      // Update & draw particles (hide if either endpoint faded out)
      particles = particles.filter((p) => {
        if (p.t > 1) return false
        const edge = EDGES[p.edgeIndex]
        return lifecycles[edge.from].opacity > 0.1 && lifecycles[edge.to].opacity > 0.1
      })
      for (const p of particles) {
        p.t += p.speed
        const edge = EDGES[p.edgeIndex]
        const a = nodes[p.forward ? edge.from : edge.to]
        const b = nodes[p.forward ? edge.to : edge.from]
        const x = lerp(a.x, b.x, p.t)
        const y = lerp(a.y, b.y, p.t)
        const [r, g, bl] = hexToRgb(p.color)
        const pAlpha = Math.min(lifecycles[edge.from].opacity, lifecycles[edge.to].opacity)

        // Core dot
        ctx!.beginPath()
        ctx!.arc(x, y, p.size, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${r},${g},${bl},${0.9 * pAlpha})`
        ctx!.fill()
      }

      // Draw nodes
      const pulse = Math.sin(timestamp * 0.002) * 0.15 + 1
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const lc = lifecycles[i]
        const op = lc.opacity
        if (op < 0.01) continue

        const [r, g, b] = hexToRgb(node.color)
        const rad = node.radius * (node.id === "team-lead" ? pulse : 1)

        // Node circle
        ctx!.beginPath()
        ctx!.arc(node.x, node.y, rad, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${r},${g},${b},${0.1 * op})`
        ctx!.strokeStyle = `rgba(${r},${g},${b},${0.6 * op})`
        ctx!.lineWidth = 1
        ctx!.fill()
        ctx!.stroke()

        // Agent name (mono)
        ctx!.font = `10px ${MONO}`
        ctx!.textAlign = "center"
        ctx!.fillStyle = `rgba(${r},${g},${b},${0.9 * op})`
        ctx!.fillText(node.label, node.x, node.y + rad + 14)

        // Status tag
        const status = lc.active && op > 0.5 ? "running" : "idle"
        const statusColor = status === "running"
          ? `rgba(${r},${g},${b},${0.5 * op})`
          : `rgba(128,128,128,${0.4 * op})`
        ctx!.font = `9px ${MONO}`
        ctx!.fillStyle = statusColor
        ctx!.fillText(status, node.x, node.y + rad + 26)
      }

      animationId = requestAnimationFrame(draw)
    }

    animationId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animationId)
      ro.disconnect()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative" }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  )
}
