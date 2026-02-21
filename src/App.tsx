import { useState, useEffect, useRef } from 'react'
import './App.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ChatResponse {
  message: string
  offTopic: boolean
}

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [storyTurnCount, setStoryTurnCount] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Fetch opening story line on mount
  useEffect(() => {
    setLoading(true)
    fetch('/api/hello')
      .then(r => r.json())
      .then((data: { message: string }) => {
        setMessages([{ role: 'assistant', content: data.message }])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const sendMessage = async () => {
    if (!input.trim() || loading) return

    const userMessage: Message = { role: 'user', content: input.trim() }
    const updatedMessages = [...messages, userMessage]
    const proposedTurnCount = storyTurnCount + 1

    setMessages(updatedMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages, storyTurnCount: proposedTurnCount }),
      })
      const data = await res.json() as ChatResponse

      setMessages(prev => [...prev, { role: 'assistant', content: data.message }])

      // Only advance the story turn counter if the user was on-topic
      if (!data.offTopic) {
        setStoryTurnCount(proposedTurnCount)
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Oops! Something went wrong. Try again!' },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>✨ Dynamic Story World</h1>
        {storyTurnCount > 0 && (
          <span className="turn-counter">Turn {storyTurnCount} / 20</span>
        )}
      </header>

      <div className="message-feed">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <span className="message-label">
              {msg.role === 'user' ? 'You' : 'Story AI'}
            </span>
            <p className="message-bubble">{msg.content}</p>
          </div>
        ))}

        {loading && (
          <div className="message assistant">
            <span className="message-label">Story AI</span>
            <p className="message-bubble typing">thinking...</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="input-bar">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Continue the story..."
          disabled={loading}
          autoFocus
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}

export default App
