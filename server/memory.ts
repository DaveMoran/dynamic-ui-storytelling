import { v4 as uuidv4 } from 'uuid'

const MEMORY_SERVER = process.env.MEMORY_SERVER_URL ?? 'http://localhost:8000'

interface ApiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface AppMessage {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPhaseLabel(turn: number): string {
  if (turn <= 1) return 'LAUNCH'
  if (turn <= 5) return 'BEGINNING'
  if (turn <= 10) return 'MIDDLE'
  if (turn <= 14) return 'CLIMAX'
  if (turn <= 19) return 'ENDING'
  return 'FINALE'
}
