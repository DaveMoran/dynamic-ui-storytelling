// localStorage fallback for when the Redis memory server is unavailable.
// All functions are safe to call — any read/write error is swallowed silently.

export interface LocalCharacter {
  name: string
  description: string
  sessionId: string
  lastPlayed: string
  storyCount: number
}

export interface LocalStory {
  id: string
  characterName: string
  title: string
  content: string // truncated summary
  savedAt: string
}

const charsKey = (uid: string) => `sw:chars:${uid}`
const storiesKey = (uid: string) => `sw:stories:${uid}`

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

export function getLocalCharacters(userId: string): LocalCharacter[] {
  return read<LocalCharacter[]>(charsKey(userId), [])
}

export function upsertLocalCharacter(userId: string, char: LocalCharacter): void {
  const chars = getLocalCharacters(userId)
  const idx = chars.findIndex(c => c.name === char.name)
  if (idx >= 0) {
    chars[idx] = { ...chars[idx], ...char }
  } else {
    chars.push(char)
  }
  write(charsKey(userId), chars)
}

export function getLocalStories(userId: string): LocalStory[] {
  return read<LocalStory[]>(storiesKey(userId), [])
}

export function saveLocalStory(userId: string, story: LocalStory): void {
  const stories = getLocalStories(userId)
  // Avoid duplicate if story was already saved (e.g., from a retry)
  if (stories.some(s => s.id === story.id)) return
  stories.push(story)
  write(storiesKey(userId), stories)
}

export function getLocalStoryCount(userId: string, characterName: string): number {
  return getLocalStories(userId).filter(s => s.characterName === characterName).length
}
