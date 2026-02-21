import { v4 as uuidv4 } from 'uuid'

const MEMORY_SERVER = process.env.MEMORY_SERVER_URL ?? 'http://localhost:8000'

export interface CharacterSummary {
  name: string
  description: string
  sessionId: string
  lastPlayed: string // ISO date string
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
    const res = await fetch(`${MEMORY_SERVER}/v1/long-term-memory/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'character story',
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
      // Extract name and description from the memory text
      // Expected format: "Character: {name}. Description: {description}. Story summary: ..."
      const nameMatch = mem.text.match(/Character:\s*([^.]+)\./)
      const descMatch = mem.text.match(/Description:\s*([^.]+(?:\.[^S][^t][^o])*?)\.?\s*Story summary:/s)
        ?? mem.text.match(/Description:\s*(.+?)(?:\.|$)/)

      if (nameMatch) {
        characters.push({
          name: nameMatch[1].trim(),
          description: descMatch ? descMatch[1].trim() : '',
          sessionId: mem.session_id ?? '',
          lastPlayed: mem.created_at ?? new Date().toISOString(),
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
            id: `char-${userId}-${characterName.toLowerCase().replace(/\s+/g, '-')}`,
            text: `Character: ${characterName}. Description: ${characterDescription}. Story summary: ${storySummary.slice(0, 300)}`,
            memory_type: 'semantic',
            topics: ['character', 'completed-story'],
            user_id: userId,
            session_id: sessionId,
          },
        ],
        deduplicate: true,
      }),
    })
  } catch {
    // Degrade gracefully
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
