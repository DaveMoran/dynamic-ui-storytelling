import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { ChatGroq } from '@langchain/groq'
import { ChatAnthropic } from '@langchain/anthropic'
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { z } from 'zod'
import {
  putWorkingMemory,
  getWorkingMemory,
  getUserCharacters,
  getStoryCounts,
  promoteToLongTermMemory,
  saveStory,
} from './memory.js'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

// ── Shared sub-schemas ────────────────────────────────────────────────────────

const ZONES = ['sky', 'ground', 'water', 'underground', 'space'] as const
const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const

const GradientStop = z.object({
  color: z.string().describe('CSS hex color e.g. #87CEEB'),
  position: z.number().min(0).max(100).describe('Numeric percentage 0–100 (integer or float, NOT a string)'),
  zone: z.enum(ZONES).describe('Environmental zone at this gradient stop'),
})

const AssetSpec = z.object({
  emoji: z.string().describe('A single emoji character'),
  zone: z.enum(ZONES).describe('Zone to place this emoji in'),
  count: z.number().int().min(1).max(10).describe(
    'Integer count 1–10 (a number, NOT a string). ' +
    'Use 1–2 for singletons (sun, moon, castle). Use 5–10 for dense groups (forest, starfield, flower field).'
  ),
  size: z.enum(SIZES).describe(
    'Visual size of each emoji — convey narrative scale: ' +
    'xs=tiny/miniature, sm=small, md=normal (default), lg=big/tall, xl=enormous/massive. ' +
    'Example: "tiny rabbit" → xs, "tall oak" → lg, "massive ancient tree" → xl.'
  ),
})

// ── Response schemas ──────────────────────────────────────────────────────────

const HelloResponse = z.object({
  message: z.string().describe('A single vivid opening sentence to start the story'),
  gradientStops: z.array(GradientStop),
  assets: z.array(AssetSpec),
})

const StoryResponse = z.object({
  message: z.string().describe('The story continuation or off-topic redirect message'),
  offTopic: z
    .boolean()
    .describe('true ONLY if the user input was unrelated to the story and was redirected'),
  suggestEnding: z
    .boolean()
    .describe(
      'true if the user\'s message naturally concludes the story — they write "the end", ' +
      '"happily ever after", a clear closing sentence, or all story threads feel resolved. ' +
      'Can happen at any turn. The user will be offered a choice to end or keep going.'
    ),
  gradientStops: z.array(GradientStop),
  assets: z.array(AssetSpec),
})

type HelloResponseType = z.infer<typeof HelloResponse>
type StoryResponseType = z.infer<typeof StoryResponse>

// ── Story phase instructions ──────────────────────────────────────────────────
function getPhaseInstructions(turn: number): string {
  if (turn === 1) {
    return 'STORY PHASE — LAUNCH: The user\'s entire message IS the character\'s name — treat it verbatim as the name, nothing else. ' +
      'Open the story by introducing this character with a vivid, exciting first sentence, place them in a setting, and hint at the adventure ahead.'
  } else if (turn <= 5) {
    return 'STORY PHASE — BEGINNING: Introduce the main character(s) and setting. Build a sense of wonder and excitement.'
  } else if (turn <= 10) {
    return 'STORY PHASE — MIDDLE: Develop the adventure. Introduce a fun challenge, mystery, or quest.'
  } else if (turn <= 14) {
    return 'STORY PHASE — CLIMAX: The challenge is at its peak! Build toward a resolution — things are getting exciting!'
  } else if (turn <= 19) {
    return 'STORY PHASE — ENDING: Start wrapping up. Guide the narrative toward a happy conclusion. Gently hint to the user that the story is nearly finished.'
  } else {
    return 'STORY PHASE — FINALE: This is the final chapter. Write a warm, joyful conclusion and tie up all loose ends with a happy ending, no matter what the user writes.'
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(storyTurnCount: number, characterContext?: string): string {
  const characterSection = characterContext
    ? `\nRETURNING CHARACTER CONTEXT:\n${characterContext}\n`
    : ''
  return `You are a friendly, imaginative storytelling assistant for children ages 6–12.${characterSection}

STORY RULES:
1. LANGUAGE: No bad words, crude language, or inappropriate content.
2. LENGTH: 2–3 sentences per response only.
3. ENDINGS: Always happy or hopeful. Never sad, scary, or bad.
4. OFF-TOPIC: If the user goes off-topic, set offTopic=true and redirect them with: "Oops! Let's get back to our story! [one recap sentence]." Do not count this turn.
5. STORY INPUT: Embrace silly or unexpected ideas. Set offTopic=false.
6. NATURAL ENDING: If the user's message signals the story has reached a natural conclusion — they write "the end", "happily ever after", a clear closing sentence, or all plot threads feel resolved — set suggestEnding=true. This can happen at any turn. Otherwise always set suggestEnding=false.
7. CONTINUATION: Read the FULL conversation history above. Your response must directly continue from the last story beat — reference the characters, locations, and events already established, and naturally weave in the user's latest message as the next moment in the ongoing story. Never restart or ignore what came before.

SCENE DESIGN — return gradientStops (3–5 stops) and assets (2–5 items):

GRADIENT STOPS: Build a multi-stop gradient that splits the scene into environmental zones.
To make a HARD LINE between zones (e.g. where sky meets ground), repeat the same position value for the last stop of one zone and the first stop of the next:
  Example sunny meadow: [sky #87CEEB@0%, sky #87CEEB@62%, ground #3CB371@62%, ground #228B22@100%]

ZONE COLORS:
  sky       → day: #87CEEB, sunset: #FF7043, night: #0D1B2A, stormy: #546E7A
  ground    → grass: #3CB371, sand: #F4D03F, snow: #ECEFF1, dirt: #8B6914
  water     → shallow: #29B6F6, deep: #006994, ocean: #0077B6
  underground → cave: #37474F, deep: #1C2526
  space     → void: #0D0D1A, nebula: #1a0a2e

EMOJI ASSETS (choose from these only):
  sky        → ☀️ 🌤️ ⛅ ☁️ 🌙 ⭐ 🌟 🌈 🦅 🦋 🐦 🌧️
  ground     → 🌲 🌳 🌴 🌵 🌿 🌺 🌸 🌻 🍄 🪨 🏡 ⛺ 🏰 🌾 🐾
  water      → 🌊 🐟 🐠 🦆 ⛵ 🪸 🐚 🦀
  underground → 💎 🔮 🦇 🍂 🌑 🪨 🕯️
  space      → 🌟 ⭐ 🪐 🚀 ☄️ 🛸
  food      → 🍎 🍌 🍕 🍔 🍦 🍩 🧁 🥕 🌽
  animals    → 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🦁 🐮 🐷 🐸 🐵 🦉

ASSET SIZING — set size to reflect how the story describes each element:
  xs → tiny, miniature  (e.g. "tiny bunny", "little bee")
  sm → small, modest    (e.g. "small bush", "a few flowers")
  md → normal / default (most items when no size is mentioned)
  lg → big, tall        (e.g. "tall oak tree", "large boulder")
  xl → enormous, massive (e.g. "massive ancient tree", "towering castle", "giant")

DENSE GROUPS — for scenes with many of the same thing, use count 5–10 with consistent size:
  Forest   → { emoji: "🌲", count: 8, size: "md" }
  Starfield → { emoji: "⭐", count: 10, size: "sm" }
  Flower field → { emoji: "🌸", count: 7, size: "sm" }

CURRENT STORY STATUS: Turn ${storyTurnCount} of 20.
${getPhaseInstructions(storyTurnCount)}`
}

/**
 * Groq validates tool call outputs strictly — if the model returns a number field
 * as a string (e.g. "40" instead of 40) the API rejects the call with a 400 that
 * includes the raw intended output in `error.failed_generation`.  This helper
 * extracts that output, coerces the known numeric fields, and re-validates with Zod.
 */
function recoverFromFailedGeneration<T>(err: unknown, schema: z.ZodType<T>): T | null {
  const raw: string | undefined =
    (err as any)?.error?.failed_generation ??
    (err as any)?.error?.error?.failed_generation
  if (!raw) return null

  const match = raw.match(/<function=\w+>([\s\S]+?)\s*<\/function>/)
  if (!match) return null

  try {
    let parsed = JSON.parse(match[1])

    // Some Groq responses wrap the payload in {type, name, parameters: {...}}
    if (parsed.parameters && typeof parsed.parameters === 'object') {
      parsed = parsed.parameters
    }

    // Groq sometimes returns arrays/booleans as JSON strings — unwrap them
    if (typeof parsed.gradientStops === 'string') {
      parsed.gradientStops = JSON.parse(parsed.gradientStops)
    }
    if (typeof parsed.assets === 'string') {
      parsed.assets = JSON.parse(parsed.assets)
    }
    if (typeof parsed.offTopic === 'string') {
      parsed.offTopic = parsed.offTopic === 'true'
    }
    if (typeof parsed.suggestEnding === 'string') {
      parsed.suggestEnding = parsed.suggestEnding === 'true'
    }

    if (Array.isArray(parsed.gradientStops)) {
      parsed.gradientStops = parsed.gradientStops.map((s: any) => ({
        ...s,
        position: Number(s.position),
      }))
    }
    if (Array.isArray(parsed.assets)) {
      parsed.assets = parsed.assets.map((a: any) => ({
        ...a,
        count: Number(a.count),
      }))
    }

    return schema.parse(parsed)
  } catch {
    return null
  }
}

const ACTIVE_PROVIDER = process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'groq'
console.log(`Using provider: ${ACTIVE_PROVIDER}`)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createModel(): any {
  if (ACTIVE_PROVIDER === 'anthropic') {
    return new ChatAnthropic({
      model: 'claude-haiku-4-5-20251001',
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
  }
  return new ChatGroq({
    model: 'llama-3.3-70b-versatile',
    apiKey: process.env.GROQ_API_KEY,
  })
}

// ── POST /api/hello ───────────────────────────────────────────────────────────
app.post('/api/hello', async (req, res) => {
  const { characterName } = req.body as { characterName?: string }

  const systemPrompt = characterName
    ? 'You are a friendly storytelling assistant for children ages 6–12. ' +
      `The child is returning to play with their character "${characterName}". ` +
      `Ask them ONE short, enthusiastic question about what adventure ${characterName} will go on today. ` +
      'Make it feel exciting and personalised — reference the character\'s name. Keep it to 1 sentence. ' +
      'For the scene, return a warm welcoming scene (bright sunny meadow) using the hard-line gradient technique. ' +
      'Include a few friendly nature emojis — nothing story-specific yet.'
    : 'You are a friendly storytelling assistant for children ages 6–12. ' +
      'Your job right now is to warmly welcome the child and ask them ONE simple question: ' +
      'what is the name of their character? ' +
      'Keep it to 1 short, enthusiastic sentence — make it feel exciting to answer! ' +
      'For the scene, return a warm, neutral welcoming scene (a bright sunny meadow) using the hard-line gradient technique to separate sky and ground zones. ' +
      'Include a few friendly nature emojis (flowers, clouds, sun) — nothing story-specific yet since the story has not started.'

  try {
    const model = createModel().withStructuredOutput(HelloResponse)

    const response: HelloResponseType = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage('Start the session.'),
    ])

    res.json(response)
  } catch (err) {
    const recovered = recoverFromFailedGeneration(err, HelloResponse)
    if (recovered) { res.json(recovered); return }
    console.error('Groq error:', err)
    res.status(500).json({ error: 'Failed to generate story' })
  }
})

// ── POST /api/chat ────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, storyTurnCount, sessionId, userId, characterContext } = req.body as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    storyTurnCount: number
    sessionId?: string
    userId?: string
    characterContext?: string
  }

  try {
    const model = createModel().withStructuredOutput(StoryResponse)

    const langchainMessages = messages
      .filter(m => m.content != null && m.content !== '')
      .map(m => m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))

    const response: StoryResponseType = await model.invoke([
      new SystemMessage(buildSystemPrompt(storyTurnCount, characterContext)),
      ...langchainMessages,
    ])

    res.json(response)

    // Fire-and-forget: persist working memory after each turn
    if (sessionId && userId) {
      putWorkingMemory(sessionId, userId, messages, storyTurnCount, characterContext).catch(() => {})
    }
  } catch (err) {
    const recovered = recoverFromFailedGeneration(err, StoryResponse)
    if (recovered) { res.json(recovered); return }
    console.error('Groq error:', err)
    res.status(500).json({ error: 'Failed to generate response' })
  }
})

function extractTitle(story: string): string {
  const match = story.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : 'Untitled Story'
}

// ── POST /api/end-story — clean up, generate description, save to Redis ───────
app.post('/api/end-story', async (req, res) => {
  const { messages, userId, sessionId, characterName, characterDescription } = req.body as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    userId?: string
    sessionId?: string
    characterName?: string
    characterDescription?: string
  }

  const conversationLog = messages
    .map(m => `${m.role === 'user' ? 'Child' : 'Story'}:\n${m.content}`)
    .join('\n\n')

  try {
    const model = createModel()

    // Step 1: weave conversation into a clean story
    const storyResponse = await model.invoke([
      new SystemMessage(
        'You are an editor for children\'s stories. ' +
        'You will receive a collaborative story log between a child and a storytelling AI. ' +
        'Your job:\n' +
        '1. Weave all story parts into a single flowing narrative — keep the child\'s ideas and characters\n' +
        '2. Remove all meta-commentary, off-topic exchanges, and AI instructions\n' +
        '3. Write a creative title at the top (# Title)\n' +
        '4. Format as clean markdown with natural paragraphs\n' +
        '5. End with "✨ The End ✨"\n' +
        '6. Aim for 200–400 words. Keep it fun, vivid, and child-appropriate.'
      ),
      new HumanMessage(`Here is the story conversation:\n\n${conversationLog}`),
    ])

    const cleanStory = storyResponse.content as string
    const title = extractTitle(cleanStory)

    // Step 2: generate a vivid character description from the story
    let aiDescription = characterDescription ?? ''
    if (characterName) {
      try {
        const descResponse = await model.invoke([
          new SystemMessage(
            'You write short character descriptions for a children\'s story app. ' +
            'Given a story, write a single vivid sentence (max 20 words) describing the main character\'s personality and what makes them special. ' +
            'Return only the description — no quotes, no preamble.'
          ),
          new HumanMessage(
            `Character name: ${characterName}\n\nStory:\n${cleanStory.slice(0, 1200)}`
          ),
        ])
        const generated = (descResponse.content as string).trim().replace(/^["']|["']$/g, '')
        if (generated) aiDescription = generated
      } catch { /* keep existing description on failure */ }
    }

    res.json({ title, story: cleanStory, characterDescription: aiDescription })

    // Fire-and-forget: save story entry + update character profile in Redis
    if (userId && sessionId && characterName) {
      saveStory(userId, sessionId, characterName, title, cleanStory).catch(() => {})
      promoteToLongTermMemory(userId, sessionId, characterName, aiDescription, cleanStory).catch(() => {})
    }
  } catch (err) {
    console.error('End story error:', err)
    res.status(500).json({ error: 'Failed to save story' })
  }
})

// ── GET /api/user/:userId/characters ─────────────────────────────────────────
app.get('/api/user/:userId/characters', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const { userId } = req.params
  const [characters, storyCounts] = await Promise.all([
    getUserCharacters(userId),
    getStoryCounts(userId),
  ])
  res.json(characters.map(c => ({ ...c, storyCount: storyCounts[c.name] ?? 0 })))
})

// ── GET /api/user/:userId/stories ─────────────────────────────────────────────
app.get('/api/user/:userId/stories', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const { userId } = req.params
  const counts = await getStoryCounts(userId)
  res.json(counts)
})

// ── GET /api/session/:sessionId/resume ────────────────────────────────────────
app.get('/api/session/:sessionId/resume', async (req, res) => {
  const { sessionId } = req.params
  const data = await getWorkingMemory(sessionId)
  res.json(data ?? null)
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Story server running on http://localhost:${PORT}`)
})
