import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { ChatGroq } from '@langchain/groq'
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { z } from 'zod'

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
  gradientStops: z.array(GradientStop),
  assets: z.array(AssetSpec),
})

type HelloResponseType = z.infer<typeof HelloResponse>
type StoryResponseType = z.infer<typeof StoryResponse>

// ── Story phase instructions ──────────────────────────────────────────────────
function getPhaseInstructions(turn: number): string {
  if (turn <= 5) {
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
function buildSystemPrompt(storyTurnCount: number): string {
  return `You are a friendly, imaginative storytelling assistant for children ages 6–12.

STORY RULES:
1. LANGUAGE: No bad words, crude language, or inappropriate content.
2. LENGTH: 2–3 sentences per response only.
3. ENDINGS: Always happy or hopeful. Never sad, scary, or bad.
4. OFF-TOPIC: If the user goes off-topic, set offTopic=true and redirect them with: "Oops! Let's get back to our story! [one recap sentence]." Do not count this turn.
5. STORY INPUT: Embrace silly or unexpected ideas. Set offTopic=false.

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
  const raw: string | undefined = (err as any)?.error?.failed_generation
  if (!raw) return null

  const match = raw.match(/<function=\w+>([\s\S]+?)\s*<\/function>/)
  if (!match) return null

  try {
    const parsed = JSON.parse(match[1])

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

function createModel() {
  return new ChatGroq({
    model: 'llama-3.3-70b-versatile',
    apiKey: process.env.GROQ_API_KEY,
  })
}

// ── GET /api/hello ────────────────────────────────────────────────────────────
app.get('/api/hello', async (_req, res) => {
  try {
    const model = createModel().withStructuredOutput(HelloResponse)

    const response: HelloResponseType = await model.invoke([
      new SystemMessage(
        'You are a friendly storytelling assistant for children ages 6–12. ' +
          'Start a magical, whimsical story with a single vivid opening sentence. ' +
          'Return a multi-stop gradient and emoji assets that match the opening scene. ' +
          'Use the hard-line gradient technique to clearly separate sky and ground zones.'
      ),
      new HumanMessage('Begin the story!'),
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
  const { messages, storyTurnCount } = req.body as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    storyTurnCount: number
  }

  try {
    const model = createModel().withStructuredOutput(StoryResponse)

    const langchainMessages = messages.map(m =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
    )

    const response: StoryResponseType = await model.invoke([
      new SystemMessage(buildSystemPrompt(storyTurnCount)),
      ...langchainMessages,
    ])

    res.json(response)
  } catch (err) {
    const recovered = recoverFromFailedGeneration(err, StoryResponse)
    if (recovered) { res.json(recovered); return }
    console.error('Groq error:', err)
    res.status(500).json({ error: 'Failed to generate response' })
  }
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Story server running on http://localhost:${PORT}`)
})
