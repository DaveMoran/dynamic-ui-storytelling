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

// Store/update working memory after each chat turn (fire-and-forget)
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
    // Degrade gracefully — memory server may be unavailable
  }
}

// Retrieve working memory to resume a session
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

// Search long-term memory for a user's characters
export async function getUserCharacters(userId: string): Promise<CharacterSummary[]> {
  try {
    // No `text` field → filter-only listing, no semantic/embedding search needed
    const res = await fetch(`${MEMORY_SERVER}/v1/long-term-memory/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: { eq: userId },
        topics: { any: ['character'] },
        limit: 20,
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

    const characters: CharacterSummary[] = []
    for (const mem of (data.memories ?? [])) {
      // Expected format: "Character: {name}. Description: {description}. Story summary: ..."
      const nameMatch = mem.text.match(/Character:\s*([^.]+)\./)
      const descMatch = mem.text.match(/Description:\s*(.*?)\.\s*Story summary:/s)
        ?? mem.text.match(/Description:\s*(.+?)(?:\.|$)/)

      if (nameMatch) {
        characters.push({
          name: nameMatch[1].trim(),
          description: descMatch ? descMatch[1].trim() : '',
          sessionId: mem.session_id ?? '',
          lastPlayed: mem.created_at ?? new Date().toISOString(),
          storyCount: 0, // populated by caller via getStoryCounts()
        })
      }
    }

    return characters
  } catch {
    return []
  }
}

// Promote completed story's character to long-term memory
export async function promoteToLongTermMemory(
  userId: string,
  sessionId: string,
  characterName: string,
  characterDescription: string,
  storySummary: string
): Promise<void> {
  try {
    await fetch(`${MEMORY_SERVER}/v1/long-term-memory/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memories: [
          {
            // Stable ID: same character name always maps to the same profile entry,
            // so each story completion updates (overwrites) the character's description
            // rather than creating duplicate entries. Story history is tracked separately.
            id: `char-${userId}-${characterName.toLowerCase().replace(/\s+/g, '-')}`,
            text: `Character: ${characterName}. Description: ${characterDescription}. Story summary: ${storySummary.slice(0, 300)}`,
            memory_type: 'semantic',
            topics: ['character', 'completed-story'],
            user_id: userId,
            session_id: sessionId,
          },
        ],
        deduplicate: false,
      }),
    })
  } catch {
    // Degrade gracefully
  }
}

// Save a completed story to long-term memory
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
          text: `Title: ${title}. Character: ${characterName}. Summary: ${content.slice(0, 500)}`,
          memory_type: 'semantic',
          topics: ['story', 'completed-story'],
          user_id: userId,
          session_id: sessionId,
        }],
        deduplicate: false,
      }),
    })
  } catch {}
}

// Get story counts keyed by character name for a given user
export async function getStoryCounts(userId: string): Promise<Record<string, number>> {
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
    if (!res.ok) return {}

    const data = await res.json() as {
      memories?: Array<{ text: string }>
    }

    const counts: Record<string, number> = {}
    for (const mem of (data.memories ?? [])) {
      const match = mem.text.match(/Character:\s*([^.]+)\./)
      if (match) {
        const name = match[1].trim()
        counts[name] = (counts[name] ?? 0) + 1
      }
    }
    return counts
  } catch {
    return {}
  }
}

function getPhaseLabel(turn: number): string {
  if (turn <= 1) return 'LAUNCH'
  if (turn <= 5) return 'BEGINNING'
  if (turn <= 10) return 'MIDDLE'
  if (turn <= 14) return 'CLIMAX'
  if (turn <= 19) return 'ENDING'
  return 'FINALE'
}
