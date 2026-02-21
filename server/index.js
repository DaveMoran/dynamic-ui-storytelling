import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { ChatGroq } from '@langchain/groq'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/hello', async (_req, res) => {
  try {
    const model = new ChatGroq({
      model: 'llama-3.3-70b-versatile',
      apiKey: process.env.GROQ_API_KEY,
    })

    const response = await model.invoke(
      'You are a friendly storytelling assistant for children ages 6-12. ' +
      'Start a magical, whimsical story with a single vivid opening sentence. ' +
      'Make it fun and imaginative!'
    )

    res.json({ message: response.content })
  } catch (err) {
    console.error('Groq API error:', err)
    res.status(500).json({ error: 'Failed to generate story' })
  }
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Story server running on http://localhost:${PORT}`)
})
