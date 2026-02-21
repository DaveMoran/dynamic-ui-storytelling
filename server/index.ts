import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { ChatGroq } from '@langchain/groq'
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const SYSTEM_PROMPT = `You are a friendly, imaginative storytelling assistant for children ages 6-12.
Help the user collaboratively build a story. Keep your responses to 2-4 sentences.
Always keep content fun, whimsical, and child-appropriate.`

// V0.0 — initial story greeting on page load
app.get('/api/hello', async (_req, res) => {
  try {
    const model = new ChatGroq({
      model: 'llama-3.3-70b-versatile',
      apiKey: process.env.GROQ_API_KEY,
    })

    const response = await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage('Start a magical story with a single vivid opening sentence. Make it fun!'),
    ])

    res.json({ message: response.content })
  } catch (err) {
    console.error('Groq API error:', err)
    res.status(500).json({ error: 'Failed to generate story' })
  }
})

// V0.2 — full conversation with history
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  }

  try {
    const model = new ChatGroq({
      model: 'llama-3.3-70b-versatile',
      apiKey: process.env.GROQ_API_KEY,
    })

    const langchainMessages = messages.map(m =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
    )

    const response = await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      ...langchainMessages,
    ])

    res.json({ message: response.content })
  } catch (err) {
    console.error('Groq API error:', err)
    res.status(500).json({ error: 'Failed to generate response' })
  }
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Story server running on http://localhost:${PORT}`)
})
