import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  lazyConnect: true,
  enableOfflineQueue: false,
})

redis.on('error', (err: Error) => {
  // Log once per error type to avoid spamming
  console.warn('[redis] connection error:', err.message)
})

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface Character {
  id: string        // charId: "char-{uuid}"
  name: string
  userId: string
  storyCount: number
  createdAt: string
  lastPlayed: string
}

export interface Story {
  id: string        // storyId: "story-{uuid}"
  characterId: string
  characterName: string
  title: string
  text: string
  savedAt: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCharacter(id: string, hash: Record<string, string>): Character {
  return {
    id,
    name: hash.name ?? '',
    userId: hash.userId ?? '',
    storyCount: parseInt(hash.storyCount ?? '0', 10),
    createdAt: hash.createdAt ?? new Date().toISOString(),
    lastPlayed: hash.lastPlayed ?? new Date().toISOString(),
  }
}

function parseStory(id: string, hash: Record<string, string>): Story {
  return {
    id,
    characterId: hash.characterId ?? '',
    characterName: hash.characterName ?? '',
    title: hash.title ?? 'Untitled',
    text: hash.text ?? '',
    savedAt: hash.savedAt ?? new Date().toISOString(),
  }
}

// ── Character CRUD ────────────────────────────────────────────────────────────

/**
 * Look up a character by name for a user; create if not found.
 */
export async function findOrCreateCharacter(
  userId: string,
  name: string
): Promise<Character | null> {
  try {
    const indexKey = `user:${userId}:chars`
    const charIds = await redis.smembers(indexKey)

    // Search for existing character with this name
    for (const charId of charIds) {
      const existingName = await redis.hget(charId, 'name')
      if (existingName === name) {
        const hash = await redis.hgetall(charId)
        return parseCharacter(charId, hash)
      }
    }

    // Create new character
    const charId = `char-${uuidv4()}`
    const now = new Date().toISOString()
    await redis.hset(charId, {
      name,
      userId,
      storyCount: '0',
      createdAt: now,
      lastPlayed: now,
    })
    await redis.sadd(indexKey, charId)

    return {
      id: charId,
      name,
      userId,
      storyCount: 0,
      createdAt: now,
      lastPlayed: now,
    }
  } catch (err) {
    console.error('[redis] findOrCreateCharacter error:', err)
    return null
  }
}

/**
 * All characters for a user (reads SET index, pipeline HGETALL each).
 */
export async function getUserCharacters(userId: string): Promise<Character[]> {
  try {
    const indexKey = `user:${userId}:chars`
    const charIds = await redis.smembers(indexKey)
    if (charIds.length === 0) return []

    const pipeline = redis.pipeline()
    for (const charId of charIds) {
      pipeline.hgetall(charId)
    }
    const results = await pipeline.exec()
    if (!results) return []

    const characters: Character[] = []
    for (let i = 0; i < charIds.length; i++) {
      const [err, hash] = results[i] as [Error | null, Record<string, string> | null]
      if (!err && hash && Object.keys(hash).length > 0) {
        characters.push(parseCharacter(charIds[i], hash))
      }
    }

    // Sort by lastPlayed descending
    return characters.sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed))
  } catch (err) {
    console.error('[redis] getUserCharacters error:', err)
    return []
  }
}

// ── Story CRUD ────────────────────────────────────────────────────────────────

/**
 * Save a story and atomically increment character storyCount + update lastPlayed.
 */
export async function saveStory(
  userId: string,
  characterId: string,
  characterName: string,
  title: string,
  text: string
): Promise<Story | null> {
  try {
    const storyId = `story-${uuidv4()}`
    const now = new Date().toISOString()

    const pipeline = redis.pipeline()
    pipeline.hset(storyId, {
      characterId,
      characterName,
      title,
      text,
      savedAt: now,
      userId,
    })
    pipeline.sadd(`${characterId}:stories`, storyId)
    pipeline.hincrby(characterId, 'storyCount', 1)
    pipeline.hset(characterId, 'lastPlayed', now)
    await pipeline.exec()

    return {
      id: storyId,
      characterId,
      characterName,
      title,
      text,
      savedAt: now,
    }
  } catch (err) {
    console.error('[redis] saveStory error:', err)
    return null
  }
}

/**
 * All stories for a character.
 */
export async function getStoriesForCharacter(characterId: string): Promise<Story[]> {
  try {
    const storyIds = await redis.smembers(`${characterId}:stories`)
    if (storyIds.length === 0) return []

    const pipeline = redis.pipeline()
    for (const storyId of storyIds) {
      pipeline.hgetall(storyId)
    }
    const results = await pipeline.exec()
    if (!results) return []

    const stories: Story[] = []
    for (let i = 0; i < storyIds.length; i++) {
      const [err, hash] = results[i] as [Error | null, Record<string, string> | null]
      if (!err && hash && Object.keys(hash).length > 0) {
        stories.push(parseStory(storyIds[i], hash))
      }
    }

    // Sort by savedAt descending
    return stories.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  } catch (err) {
    console.error('[redis] getStoriesForCharacter error:', err)
    return []
  }
}
