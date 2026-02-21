import { v4 as uuidv4 } from 'uuid'

const MEMORY_SERVER = process.env.MEMORY_SERVER_URL ?? 'http://localhost:8000'

export interface CharacterSummary {
  name: string
  description: string
  sessionId: string
  lastPlayed: string // ISO date string
  storyCount: number
}

interface ApiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

interface AppMessage {
  role: 'user' | 'assistant'
  content: string
}

function toApiMessages(messages: AppMessage[]): ApiMessage[] {
  return messages.map((m, i) => ({
    id: `msg-${i}-${uuidv4()}`,
    role: m.role,
    content: m.content,
    created_at: new Date().toISOString(),
  }))
}

// ── Working memory (session-scoped) ───────────────────────────────────────────

export async function putWorkingMemory(
  sessionId: string,
  userId: string,
  messages: AppMessage[],
  storyTurnCount: number,
  characterContext?: string
): Promise<void> {
  try {
    const memories: Array<{
      id: string
      text: string
      memory_type: string
      topics: string[]
    }> = [
      {
        id: `story-state-${sessionId}`,
        text: `Current story turn: ${storyTurnCount}. Phase: ${getPhaseLabel(storyTurnCount)}.`,
        memory_type: 'semantic',
        topics: ['story-state'],
      },
    ]

    if (characterContext) {
      memories.push({
        id: `character-${sessionId}`,
        text: characterContext,
        memory_type: 'semantic',
        topics: ['character'],
      })
    }

    await fetch(`${MEMORY_SERVER}/v1/working-memory/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        messages: toApiMessages(messages),
        memories,
      }),
    })
  } catch {
    // Degrade gracefully
  }
}

export async function getWorkingMemory(sessionId: string): Promise<{
  messages: AppMessage[]
  storyTurnCount: number
  characterContext?: string
} | null> {
  try {
    const res = await fetch(`${MEMORY_SERVER}/v1/working-memory/${sessionId}`)
    if (!res.ok) return null

    const data = await res.json() as {
      messages?: ApiMessage[]
      memories?: Array<{ text: string; topics?: string[] }>
    }

    const messages: AppMessage[] = (data.messages ?? []).map(m => ({
      role: m.role,
      content: m.content,
    }))

    let storyTurnCount = 0
    let characterContext: string | undefined

    for (const mem of (data.memories ?? [])) {
      if (mem.topics?.includes('story-state')) {
        const match = mem.text.match(/Current story turn: (\d+)/)
        if (match) storyTurnCount = parseInt(match[1], 10)
      }
      if (mem.topics?.includes('character')) {
        characterContext = mem.text
      }
    }

    return { messages, storyTurnCount, characterContext }
  } catch {
    return null
  }
}

// ── Long-term memory: characters ──────────────────────────────────────────────

// Save one character entry per story completion.
// Uses a unique session-based ID so there is never an overwrite/upsert risk.
// storyCount is derived by counting how many entries exist for a given name.
export async function saveCharacter(
  userId: string,
  sessionId: string,
  characterName: string,
  characterDescription: string
): Promise<void> {
  try {
    await fetch(`${MEMORY_SERVER}/v1/long-term-memory/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memories: [{
          id: `char-${userId}-${sessionId.slice(0, 8)}`,
          text: `Character: ${characterName}. Description: ${characterDescription}.`,
          memory_type: 'semantic',
          topics: ['character'],
          user_id: userId,
          session_id: sessionId,
        }],
        deduplicate: false,
      }),
    })
  } catch {}
}

// Retrieve all character entries for a user, deduplicated by name.
// storyCount = number of entries found for that name.
export async function getUserCharacters(userId: string): Promise<CharacterSummary[]> {
  try {
    const res = await fetch(`${MEMORY_SERVER}/v1/long-term-memory/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: { eq: userId },
        topics: { any: ['character'] },
        limit: 100,
      }),
    })
    if (!res.ok) return []

    const data = await res.json() as {
      memories?: Array<{
        text: string
        session_id?: string
        created_at?: string
      }>
    }

    // Group by character name, keep most recent entry, count total per name
    const byName = new Map<string, {
      description: string
      sessionId: string
      lastPlayed: string
      count: number
    }>()

    for (const mem of (data.memories ?? [])) {
      const nameMatch = mem.text.match(/Character:\s*([^.]+)\./)
      if (!nameMatch) continue

      const name = nameMatch[1].trim()
      const descMatch = mem.text.match(/Description:\s*(.*?)\.?\s*$/)
      const description = descMatch ? descMatch[1].trim() : ''
      const createdAt = mem.created_at ?? new Date().toISOString()

      const existing = byName.get(name)
      if (!existing) {
        byName.set(name, { description, sessionId: mem.session_id ?? '', lastPlayed: createdAt, count: 1 })
      } else {
        existing.count += 1
        if (createdAt > existing.lastPlayed) {
          existing.description = description
          existing.sessionId = mem.session_id ?? existing.sessionId
          existing.lastPlayed = createdAt
        }
      }
    }

    return Array.from(byName.entries()).map(([name, info]) => ({
      name,
      description: info.description,
      sessionId: info.sessionId,
      lastPlayed: info.lastPlayed,
      storyCount: info.count,
    }))
  } catch {
    return []
  }
}

// ── Long-term memory: stories ─────────────────────────────────────────────────

// Save one story entry per story completion, completely separate from character entries.
export async function saveStory(
  userId: string,
  sessionId: string,
  characterName: string,
  title: string,
  content: string
): Promise<void> {
  try {
    await fetch(`${MEMORY_SERVER}/v1/long-term-memory/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memories: [{
          id: `story-${userId}-${sessionId.slice(0, 8)}`,
          text: `Title: ${title}. Character: ${characterName}. Summary: ${content.slice(0, 400)}`,
          memory_type: 'semantic',
          topics: ['story'],
          user_id: userId,
          session_id: sessionId,
        }],
        deduplicate: false,
      }),
    })
  } catch {}
}

// Retrieve all story entries for a user
export async function getStoriesForUser(userId: string): Promise<Array<{
  title: string
  characterName: string
  sessionId: string
  savedAt: string
}>> {
  try {
    const res = await fetch(`${MEMORY_SERVER}/v1/long-term-memory/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: { eq: userId },
        topics: { any: ['story'] },
        limit: 100,
      }),
    })
    if (!res.ok) return []

    const data = await res.json() as {
      memories?: Array<{
        text: string
        session_id?: string
        created_at?: string
      }>
    }

    const stories = []
    for (const mem of (data.memories ?? [])) {
      const titleMatch = mem.text.match(/Title:\s*([^.]+)\./)
      const nameMatch = mem.text.match(/Character:\s*([^.]+)\./)
      stories.push({
        title: titleMatch ? titleMatch[1].trim() : 'Untitled',
        characterName: nameMatch ? nameMatch[1].trim() : '',
        sessionId: mem.session_id ?? '',
        savedAt: mem.created_at ?? new Date().toISOString(),
      })
    }
    return stories
  } catch {
    return []
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPhaseLabel(turn: number): string {
  if (turn <= 1) return 'LAUNCH'
  if (turn <= 5) return 'BEGINNING'
  if (turn <= 10) return 'MIDDLE'
  if (turn <= 14) return 'CLIMAX'
  if (turn <= 19) return 'ENDING'
  return 'FINALE'
}
