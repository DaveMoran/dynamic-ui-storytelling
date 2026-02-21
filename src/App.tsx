import { useState, useEffect, useRef } from 'react'
import './App.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type ZoneType = 'sky' | 'ground' | 'water' | 'underground' | 'space'

interface GradientStop {
  color: string
  position: number // 0–100
  zone: ZoneType
}

interface AssetSpec {
  emoji: string
  zone: ZoneType
  count: number
}

interface PlacedAsset {
  id: string
  emoji: string
  x: number   // % from left
  y: number   // % from top
  size: number // rem
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface SceneData {
  gradientStops: GradientStop[]
  assets: AssetSpec[]
}

interface HelloResponse extends SceneData {
  message: string
}

interface ChatResponse extends SceneData {
  message: string
  offTopic: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildGradient(stops: GradientStop[]): string {
  if (!stops.length) return 'linear-gradient(to bottom, #87CEEB, #90EE90)'
  return `linear-gradient(to bottom, ${stops.map(s => `${s.color} ${s.position}%`).join(', ')})`
}

/** Compute the vertical band (min%–max%) each zone occupies. */
function computeZoneRanges(stops: GradientStop[]): Record<string, { min: number; max: number }> {
  const ranges: Record<string, { min: number; max: number }> = {}
  for (const stop of stops) {
    if (!ranges[stop.zone]) {
      ranges[stop.zone] = { min: stop.position, max: stop.position }
    } else {
      ranges[stop.zone].min = Math.min(ranges[stop.zone].min, stop.position)
      ranges[stop.zone].max = Math.max(ranges[stop.zone].max, stop.position)
    }
  }
  return ranges
}

/** Place emoji assets within their zone's vertical band. */
function generatePlacedAssets(specs: AssetSpec[], stops: GradientStop[]): PlacedAsset[] {
  const ranges = computeZoneRanges(stops)
  const placed: PlacedAsset[] = []
  const usedX: number[] = []

  for (const spec of specs) {
    const range = ranges[spec.zone]
    if (!range) continue

    const isGround = spec.zone === 'ground'
    const zoneHeight = range.max - range.min

    for (let i = 0; i < spec.count; i++) {
      // Pick x with spacing from existing placements
      let x = 5 + Math.random() * 84
      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = 5 + Math.random() * 84
        if (!usedX.some(u => Math.abs(u - candidate) < 11)) {
          x = candidate
          break
        }
      }
      usedX.push(x)

      let y: number
      if (isGround) {
        // Anchor near the horizon (top edge of ground zone) so trees sit on the ground line
        y = range.min + zoneHeight * (Math.random() * 0.28)
      } else {
        // Distribute freely throughout the zone
        y = range.min + zoneHeight * (0.08 + Math.random() * 0.72)
      }

      const isSingleton = ['☀️', '🌙', '🌟', '🌈', '🪐'].includes(spec.emoji)
      const size = isGround ? 3.6 : isSingleton ? 3.4 : 2.4

      placed.push({
        id: `${spec.emoji}-${i}-${Math.random().toString(36).slice(2)}`,
        emoji: spec.emoji,
        x,
        y,
        size,
      })
    }
  }

  return placed
}

/** Average luminance across all gradient stops for contrast detection. */
function hexLuminance(hex: string): number {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return 0.5
  const [r, g, b] = [result[1], result[2], result[3]].map(c => {
    const s = parseInt(c, 16) / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// ── Default scene (shown while /api/hello loads) ──────────────────────────────

const DEFAULT_STOPS: GradientStop[] = [
  { color: '#87CEEB', position: 0, zone: 'sky' },
  { color: '#87CEEB', position: 65, zone: 'sky' },
  { color: '#3CB371', position: 65, zone: 'ground' },
  { color: '#228B22', position: 100, zone: 'ground' },
]

// ── Component ─────────────────────────────────────────────────────────────────

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [storyTurnCount, setStoryTurnCount] = useState(0)

  // Background crossfade state
  const [bgBase, setBgBase] = useState(buildGradient(DEFAULT_STOPS))
  const [bgIncoming, setBgIncoming] = useState<string | null>(null)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Asset layer
  const [placedAssets, setPlacedAssets] = useState<PlacedAsset[]>([])
  const [gradientStops, setGradientStops] = useState<GradientStop[]>(DEFAULT_STOPS)

  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const applyScene = ({ gradientStops: stops, assets }: SceneData) => {
    const newGradient = buildGradient(stops)

    // Crossfade: mount the incoming layer (CSS animation handles fade-in)
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    setBgIncoming(newGradient)
    fadeTimer.current = setTimeout(() => {
      setBgBase(newGradient)
      setBgIncoming(null)
    }, 2200)

    setGradientStops(stops)
    setPlacedAssets(generatePlacedAssets(assets, stops))
  }

  // Fetch opening story line on mount
  useEffect(() => {
    setLoading(true)
    fetch('/api/hello')
      .then(r => r.json())
      .then((data: HelloResponse) => {
        setMessages([{ role: 'assistant', content: data.message }])
        applyScene(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = async () => {
    if (!input.trim() || loading) return

    const userMessage: Message = { role: 'user', content: input.trim() }
    const updatedMessages = [...messages, userMessage]
    const proposedTurnCount = storyTurnCount + 1

    setMessages(updatedMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages, storyTurnCount: proposedTurnCount }),
      })
      const data = await res.json() as ChatResponse

      setMessages(prev => [...prev, { role: 'assistant', content: data.message }])
      applyScene(data)

      if (!data.offTopic) {
        setStoryTurnCount(proposedTurnCount)
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Oops! Something went wrong. Try again!' },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Derive text contrast from current gradient stops
  const avgLuminance =
    gradientStops.reduce((sum, s) => sum + hexLuminance(s.color), 0) /
    Math.max(gradientStops.length, 1)
  const isDark = avgLuminance < 0.35

  return (
    <div className="scene">
      {/* Layer 0 — settled background */}
      <div className="bg-layer" style={{ background: bgBase }} />

      {/* Layer 1 — incoming background (fades in via CSS animation) */}
      {bgIncoming && (
        <div
          key={bgIncoming}
          className="bg-layer bg-layer-incoming"
          style={{ background: bgIncoming }}
        />
      )}

      {/* Layer 2 — emoji assets */}
      <div className="asset-layer">
        {placedAssets.map(asset => (
          <span
            key={asset.id}
            className="scene-asset"
            style={{
              left: `${asset.x}%`,
              top: `${asset.y}%`,
              fontSize: `${asset.size}rem`,
            }}
          >
            {asset.emoji}
          </span>
        ))}
      </div>

      {/* Layer 3 — chat UI */}
      <div
        className="scene-content"
        style={
          {
            '--input-text-color': isDark ? 'rgba(255,255,255,0.92)' : '#1a1a1a',
            '--input-placeholder-color': isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.38)',
          } as React.CSSProperties
        }
      >
        <div className="chat-container">
          <header className="app-header">
            <h1>✨ Dynamic Story World</h1>
            {storyTurnCount > 0 && (
              <span className="turn-counter">Turn {storyTurnCount} / 20</span>
            )}
          </header>

          <div className="message-feed">
            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role}`}>
                <span className="message-label">
                  {msg.role === 'user' ? 'You' : 'Story AI'}
                </span>
                <p className="message-bubble">{msg.content}</p>
              </div>
            ))}

            {loading && (
              <div className="message assistant">
                <span className="message-label">Story AI</span>
                <p className="message-bubble typing">thinking...</p>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className="input-bar">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Continue the story..."
              disabled={loading}
              autoFocus
            />
            <button onClick={sendMessage} disabled={loading || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
