import { useState, useEffect, useRef } from 'react'
import './App.css'
import {
  getLocalCharacters,
  upsertLocalCharacter,
  saveLocalStory,
  getLocalStoryCount,
} from './localStore'

// ── Types ─────────────────────────────────────────────────────────────────────

type ZoneType = 'sky' | 'air' | 'ground' | 'water' | 'underground' | 'space'

interface GradientStop {
  color: string
  position: number // 0–100
  zone: ZoneType
}

type SizeType = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE_MAP: Record<SizeType, number> = {
  xs: 1.4,
  sm: 2.1,
  md: 3.0,
  lg: 4.4,
  xl: 6.2,
}

interface AssetSpec {
  emoji: string
  zone: ZoneType
  count: number
  size: SizeType
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
  suggestEnding: boolean
}

interface CharacterSummary {
  id: string          // charId — needed to save new stories against the same character
  name: string
  storyCount: number
  lastPlayed: string
}

type UIMode = 'welcome' | 'character-select' | 'chatting' | 'suggest-ending' | 'ended'

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
    const zoneKey = spec.zone === 'air' ? 'sky' : spec.zone
    const range = ranges[zoneKey]
    if (!range) continue

    const isGround = spec.zone === 'ground'
    const zoneHeight = range.max - range.min
    const size = SIZE_MAP[spec.size] ?? SIZE_MAP.md

    // Allow tighter packing for large groups — min spacing scales down with count
    const minSpacing = spec.count <= 3 ? 13 : spec.count <= 6 ? 9 : 6

    for (let i = 0; i < spec.count; i++) {
      let x = 5 + Math.random() * 84
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = 5 + Math.random() * 84
        if (!usedX.some(u => Math.abs(u - candidate) < minSpacing)) {
          x = candidate
          break
        }
      }
      usedX.push(x)

      let y: number
      if (isGround) {
        // Anchor near the horizon so assets sit on the ground line
        y = range.min + zoneHeight * (Math.random() * 0.28)
      } else {
        // Distribute freely throughout the zone
        y = range.min + zoneHeight * (0.08 + Math.random() * 0.72)
      }

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

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
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

  // Story ending flow
  const [uiMode, setUiMode] = useState<UIMode>('welcome')
  const [savedTitle, setSavedTitle] = useState<string | null>(null)

  // Memory / identity state
  const [userId, setUserId] = useState('')
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID())
  const [characterId, setCharacterId] = useState<string | undefined>()
  const [characterContext, setCharacterContext] = useState<string | undefined>()
  const [availableCharacters, setAvailableCharacters] = useState<CharacterSummary[]>([])
  const [welcomeInput, setWelcomeInput] = useState('')

  const bottomRef = useRef<HTMLDivElement>(null)

  // Mobile responsive state
  const [mobileTab, setMobileTab] = useState<'story' | 'chat' | 'controls'>('controls')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768)
  const [hasUnreadAI, setHasUnreadAI] = useState(false)
  const mobileTabRef = useRef<'story' | 'chat' | 'controls'>('controls')

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Keep ref in sync so async sendMessage can read latest tab
  useEffect(() => { mobileTabRef.current = mobileTab }, [mobileTab])

  // Resize listener — keep isMobile in sync
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // Auto-switch tab when uiMode changes
  useEffect(() => {
    if (!isMobile) return
    if (uiMode === 'welcome' || uiMode === 'character-select' || uiMode === 'ended') {
      setMobileTab('controls')
    } else if (uiMode === 'chatting' || uiMode === 'suggest-ending') {
      setMobileTab('chat')
    }
  }, [uiMode, isMobile])

  const applyScene = ({ gradientStops: stops, assets }: SceneData) => {
    const newGradient = buildGradient(stops)

    // Crossfade: mount the incoming layer (CSS animation handles fade-in)
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    setBgIncoming(newGradient)
    fadeTimer.current = setTimeout(() => {
      setBgBase(newGradient)
      setBgIncoming(null)
    }, 2200)

    setPlacedAssets(generatePlacedAssets(assets, stops))
  }

  const startNewStory = (ctxOverride?: string) => {
    setMessages([])
    setStoryTurnCount(0)
    setInput('')
    setUiMode('chatting')
    setSavedTitle(null)
    setPlacedAssets([])
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    setBgBase(buildGradient(DEFAULT_STOPS))
    setBgIncoming(null)

    // Extract the character name from the context so the greeting can reference them
    const charName = ctxOverride
      ? ctxOverride.replace(/:.*$/, '').trim() // "Rosie: desc" → "Rosie"
      : undefined

    setLoading(true)
    fetch('/api/hello', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterName: charName }),
    })
      .then(r => r.json())
      .then((data: HelloResponse) => {
        setMessages([{ role: 'assistant', content: data.message }])
        applyScene(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))

    if (ctxOverride !== undefined) {
      setCharacterContext(ctxOverride)
    }
  }

  // Fetch characters with cache bust. Falls back to localStorage if Redis is unavailable.
  const fetchAndShowCharacters = (uid: string) => {
    const showChars = (chars: CharacterSummary[]) => {
      setAvailableCharacters(chars)
      setUiMode('character-select')
    }
    const fallbackToLocal = () => {
      const localChars = getLocalCharacters(uid).map(c => ({
        id: `local-${slugify(c.name)}`,
        name: c.name,
        storyCount: c.storyCount,
        lastPlayed: c.lastPlayed,
      }))
      if (localChars.length > 0) showChars(localChars)
      else startNewStory()
    }

    fetch(`/api/user/${uid}/characters`, { cache: 'no-store' })
      .then(r => r.json())
      .then((chars: CharacterSummary[]) => {
        if (chars.length > 0) showChars(chars)
        else fallbackToLocal()
      })
      .catch(fallbackToLocal)
  }

  // On mount: check localStorage for existing userId
  useEffect(() => {
    const storedUserId = localStorage.getItem('storyUserId')
    if (storedUserId) {
      setUserId(storedUserId)
      fetchAndShowCharacters(storedUserId)
    }
    // else: stay on welcome screen (default uiMode)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleWelcomeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const name = welcomeInput.trim()
    if (!name) return

    const newUserId = `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`
    setUserId(newUserId)
    localStorage.setItem('storyUserId', newUserId)
    fetchAndShowCharacters(newUserId)
  }

  const handleContinueMidStory = (character: CharacterSummary) => {
    setCharacterId(character.id)
    handleNewAdventureWith(character)
  }

  const handleNewAdventureWith = (character: CharacterSummary) => {
    setCharacterId(character.id)
    setCharacterContext(character.name)
    setSessionId(crypto.randomUUID())
    startNewStory(character.name)
  }

  const handleNewStory = () => {
    setCharacterId(undefined)
    setCharacterContext(undefined)
    setSessionId(crypto.randomUUID())
    startNewStory()
  }

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
        body: JSON.stringify({
          messages: updatedMessages,
          storyTurnCount: proposedTurnCount,
          sessionId,
          userId,
          characterContext,
        }),
      })
      const data = await res.json() as ChatResponse

      setMessages(prev => [...prev, { role: 'assistant', content: data.message }])
      if (mobileTabRef.current !== 'chat') setHasUnreadAI(true)
      applyScene(data)

      if (!data.offTopic) {
        setStoryTurnCount(proposedTurnCount)
      }

      if (data.suggestEnding) {
        setUiMode('suggest-ending')
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

  // For returning characters the name lives in characterContext — always prefer that.
  // For brand-new characters there is no characterContext, so the first user message IS the name.
  const deriveCharacterName = (): string | undefined => {
    if (characterContext) {
      const match = characterContext.match(/^([^:]+):/)
      if (match) return match[1].trim()
      return characterContext.trim()
    }
    return messages.find(m => m.role === 'user')?.content?.trim()
  }

  // Description is whatever follows "Name: " in characterContext, or empty for new chars.
  const deriveCharacterDescription = (): string => {
    if (characterContext) {
      return characterContext.replace(/^[^:]+:\s*/, '').trim()
    }
    return ''
  }

  const handleNewAdventureWithCurrent = () => {
    setCharacterId(undefined)
    const name = deriveCharacterName() ?? ''
    const ctx = name || undefined
    setCharacterContext(ctx)
    setSessionId(crypto.randomUUID())
    startNewStory(ctx)
  }

  const endStory = async () => {
    setLoading(true)
    try {
      const characterName = deriveCharacterName()
      const characterDescription = deriveCharacterDescription() || 'a brave adventurer'
      const res = await fetch('/api/end-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          userId,
          sessionId,
          characterName,
          characterDescription,
          characterId,
        }),
      })
      const data = await res.json() as { title: string; story: string; characterDescription: string; characterId?: string }
      setSavedTitle(data.title)
      if (data.characterId) setCharacterId(data.characterId)
      setUiMode('ended')

      // Write to localStorage as a fallback for when Redis is unavailable
      const charName = deriveCharacterName() ?? ''
      if (userId && charName) {
        const newStoryCount = getLocalStoryCount(userId, charName) + 1
        upsertLocalCharacter(userId, {
          name: charName,
          description: data.characterDescription,
          sessionId,
          lastPlayed: new Date().toISOString(),
          storyCount: newStoryCount,
        })
        saveLocalStory(userId, {
          id: data.characterId ? `story-${data.characterId.slice(0, 8)}` : `story-${sessionId.slice(0, 8)}`,
          characterName: charName,
          title: data.title,
          content: data.story.slice(0, 500),
          savedAt: new Date().toISOString(),
        })
      }

      // Refresh Redis character list in the background
      if (userId) {
        fetch(`/api/user/${userId}/characters`, { cache: 'no-store' })
          .then(r => r.json())
          .then((chars: CharacterSummary[]) => { if (chars.length > 0) setAvailableCharacters(chars) })
          .catch(() => {})
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Oops! Could not save the story. Try again!' },
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

  return (
    <div className="app-layout">

      {/* ── Scene area (left, fills remaining width) ── */}
      <div className={`scene-area${isMobile && mobileTab !== 'story' ? ' mobile-hidden' : ''}`}>
        <div className="bg-layer" style={{ background: bgBase }} />
        {bgIncoming && (
          <div
            key={bgIncoming}
            className="bg-layer bg-layer-incoming"
            style={{ background: bgIncoming }}
          />
        )}
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
      </div>

      {/* ── Chat sidebar (right, fixed width) ── */}
      <div className={`chat-sidebar${isMobile && mobileTab === 'story' ? ' mobile-hidden' : ''}`}>
        <header className="app-header">
          <h1>✨ Dynamic Story World</h1>
          {storyTurnCount > 0 && (
            <span className="turn-counter">Turn {storyTurnCount} / 20</span>
          )}
        </header>

        {/* ── Mobile in-story controls card (replaces feed on Controls tab) ── */}
        {isMobile && mobileTab === 'controls' && (uiMode === 'chatting' || uiMode === 'suggest-ending') ? (
          <div className="mobile-in-story-card">
            <p className="mobile-story-label">Story in progress</p>
            <p className="mobile-char-name">{deriveCharacterName()}</p>
            <p className="mobile-turn-count">Turn {storyTurnCount} / 20</p>
            <button className="btn-end-mobile" onClick={() => setUiMode('suggest-ending')}>
              End Story
            </button>
          </div>
        ) : (
          <>
            {/* ── Welcome screen ── */}
            {uiMode === 'welcome' && (
              <div className="welcome-screen">
                <p className="welcome-prompt">What's your name, storyteller?</p>
                <form onSubmit={handleWelcomeSubmit} className="welcome-form">
                  <input
                    type="text"
                    value={welcomeInput}
                    onChange={e => setWelcomeInput(e.target.value)}
                    placeholder="Enter your name..."
                    autoFocus
                    className="welcome-input"
                  />
                  <button
                    type="submit"
                    className="btn-welcome"
                    disabled={!welcomeInput.trim()}
                  >
                    Let's Go!
                  </button>
                </form>
              </div>
            )}

            {/* ── Character select screen ── */}
            {uiMode === 'character-select' && (
              <div className="character-select">
                <p className="character-select-heading">Welcome back! Pick an adventure:</p>
                <div className="character-list">
                  {availableCharacters.map(char => (
                    <div key={char.id} className="character-card">
                      <div className="character-card-info">
                        <div className="character-card-header">
                          <span className="character-card-name">{char.name}</span>
                          <span className="story-count-badge">
                            {char.storyCount} {char.storyCount === 1 ? 'story' : 'stories'}
                          </span>
                        </div>
                        <span className="character-card-date">Last played: {formatDate(char.lastPlayed)}</span>
                      </div>
                      <div className="character-card-actions">
                        <button
                          className="btn-continue-story"
                          onClick={() => handleContinueMidStory(char)}
                          disabled={loading}
                        >
                          Continue
                        </button>
                        <button
                          className="btn-new-adventure"
                          onClick={() => handleNewAdventureWith(char)}
                          disabled={loading}
                        >
                          New adventure
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="btn-brand-new" onClick={handleNewStory} disabled={loading}>
                  Start a brand new story
                </button>
              </div>
            )}

            {/* ── Message feed (chatting / suggest-ending / ended) ── */}
            {(uiMode === 'chatting' || uiMode === 'suggest-ending' || uiMode === 'ended') && (
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
            )}

            {uiMode === 'chatting' && (
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
            )}

            {uiMode === 'suggest-ending' && (
              <div className="ending-choice">
                <p className="ending-prompt">✨ Your story is coming to a close!</p>
                <div className="ending-buttons">
                  <button
                    className="btn-end"
                    onClick={endStory}
                    disabled={loading}
                  >
                    End Story
                  </button>
                  <button
                    className="btn-continue"
                    onClick={() => setUiMode('chatting')}
                    disabled={loading}
                  >
                    Continue Story
                  </button>
                </div>
              </div>
            )}

            {uiMode === 'ended' && (
              <div className="ending-choice">
                {savedTitle && (
                  <p className="ending-saved">📖 <strong>"{savedTitle}"</strong> has been saved!</p>
                )}
                <p className="ending-prompt">What's next?</p>
                <div className="ending-buttons">
                  <button className="btn-end" onClick={handleNewAdventureWithCurrent} disabled={loading}>
                    New adventure with {deriveCharacterName() ?? 'this character'}
                  </button>
                  <button
                    className="btn-continue"
                    onClick={() => userId ? fetchAndShowCharacters(userId) : handleNewStory()}
                    disabled={loading}
                  >
                    New character
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Mobile bottom tab bar (hidden on desktop via CSS) ── */}
      <nav className="mobile-tab-bar">
        <button
          className={`mobile-tab${mobileTab === 'story' ? ' active' : ''}`}
          onClick={() => setMobileTab('story')}
        >
          <span className="mobile-tab-icon">🌄</span>
          <span className="mobile-tab-label">Scene</span>
        </button>

        <button
          className={`mobile-tab${mobileTab === 'chat' ? ' active' : ''}`}
          onClick={() => { setMobileTab('chat'); setHasUnreadAI(false) }}
        >
          <span className="mobile-tab-icon">💬</span>
          <span className="mobile-tab-label">Chat</span>
          {hasUnreadAI && <span className="tab-badge" />}
        </button>

        <button
          className={`mobile-tab${mobileTab === 'controls' ? ' active' : ''}`}
          onClick={() => setMobileTab('controls')}
        >
          <span className="mobile-tab-icon">🎭</span>
          <span className="mobile-tab-label">Characters</span>
        </button>
      </nav>

    </div>
  )
}

export default App
