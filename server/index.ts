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

// ── Structured output schemas ─────────────────────────────────────────────────

const HelloResponse = z.object({
  message: z.string().describe('A single vivid opening sentence to start the story'),
  gradientStart: z.string().describe('CSS hex color for the top of the background gradient'),
  gradientEnd: z.string().describe('CSS hex color for the bottom of the background gradient'),
})

const StoryResponse = z.object({
  message: z.string().describe('The story continuation or off-topic redirect message'),
  offTopic: z
    .boolean()
    .describe('true ONLY if the user input was unrelated to the story and was redirected'),
  gradientStart: z
    .string()
    .describe(
      'CSS hex color for the top of the background gradient — match the story scene and mood. ' +
        'Examples: sunny=#87CEEB, night=#0D1B2A, forest=#1B5E20, sunset=#FF6B6B, ocean=#0077B6, ' +
        'magical=#6C63FF, snow=#E0F7FA, desert=#F4A261, cave=#37474F'
    ),
  gradientEnd: z
    .string()
    .describe(
      'CSS hex color for the bottom of the background gradient — complementary to gradientStart. ' +
        'Examples: sunny=#90EE90, night=#1B263B, forest=#2E7D32, sunset=#FFB347, ocean=#00B4D8, ' +
        'magical=#F7B733, snow=#B2EBF2, desert=#E9C46A, cave=#546E7A'
    ),
})

type HelloResponseType = z.infer<typeof HelloResponse>
type StoryResponseType = z.infer<typeof StoryResponse>

// ── Story phase instructions by turn ─────────────────────────────────────────
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

// ── Dynamic system prompt ─────────────────────────────────────────────────────
function buildSystemPrompt(storyTurnCount: number): string {
  return `You are a friendly, imaginative storytelling assistant for children ages 6–12.

RULES — follow these strictly at all times:
1. LANGUAGE: Absolutely no bad words, crude language, or inappropriate content of any kind.
2. LENGTH: Keep every response to 2–3 sentences only. Short and vivid.
3. ENDINGS: Stories must always end happily or hopefully. Never write sad, scary, or bad endings.
4. OFF-TOPIC: If the user writes something completely unrelated to the story (e.g. random questions, requests for inappropriate content, real-world topics), set offTopic to true and respond with a friendly redirect — e.g. "Oops! Let's get back to our story! [one sentence recap of where we left off]." Do NOT count this as a story turn.
5. STORY INPUT: Even unusual, silly, or unexpected story ideas should be embraced and set offTopic to false.
6. BACKGROUND COLORS: Choose gradientStart and gradientEnd hex colors that visually match the current scene — sky, time of day, location, and mood. Keep colors bright and child-friendly.

CURRENT STORY STATUS: Turn ${storyTurnCount} of 20.
${getPhaseInstructions(storyTurnCount)}`
}

function createModel() {
  return new ChatGroq({
    model: 'llama-3.3-70b-versatile',
    apiKey: process.env.GROQ_API_KEY,
  })
}

// ── GET /api/hello — opening story line on page load ─────────────────────────
app.get('/api/hello', async (_req, res) => {
  try {
    const model = createModel().withStructuredOutput(HelloResponse)

    const response: HelloResponseType = await model.invoke([
      new SystemMessage(
        'You are a friendly storytelling assistant for children ages 6–12. ' +
          'Start a magical, whimsical story with a single vivid opening sentence. ' +
          'Also choose two CSS hex gradient colors that match the opening scene mood.'
      ),
      new HumanMessage('Begin the story!'),
    ])

    res.json(response)
  } catch (err) {
    console.error('Groq error:', err)
    res.status(500).json({ error: 'Failed to generate story' })
  }
})

// ── POST /api/chat — full conversation with turn tracking ─────────────────────
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
    console.error('Groq error:', err)
    res.status(500).json({ error: 'Failed to generate response' })
  }
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Story server running on http://localhost:${PORT}`)
})
