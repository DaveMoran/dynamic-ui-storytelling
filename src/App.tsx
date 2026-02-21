import { useState, useEffect, useRef } from 'react'
import './App.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Background {
  gradientStart: string
  gradientEnd: string
}

interface ChatResponse {
  message: string
  offTopic: boolean
  gradientStart: string
  gradientEnd: string
}

interface HelloResponse {
  message: string
  gradientStart: string
  gradientEnd: string
}

function hexLuminance(hex: string): number {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return 0.5
  const [r, g, b] = [result[1], result[2], result[3]].map(c => {
    const s = parseInt(c, 16) / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [storyTurnCount, setStoryTurnCount] = useState(0)
  const [background, setBackground] = useState<Background>({
    gradientStart: '#87CEEB',
    gradientEnd: '#90EE90',
  })
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
      .then((data: HelloResponse) => {
        setMessages([{ role: 'assistant', content: data.message }])
        setBackground({ gradientStart: data.gradientStart, gradientEnd: data.gradientEnd })
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
      setBackground({ gradientStart: data.gradientStart, gradientEnd: data.gradientEnd })

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

  const avgLuminance =
    (hexLuminance(background.gradientStart) + hexLuminance(background.gradientEnd)) / 2
  const isDark = avgLuminance < 0.35

  return (
    <div
      className="scene"
      style={
        {
          '--grad-start': background.gradientStart,
          '--grad-end': background.gradientEnd,
          '--input-text-color': isDark ? 'rgba(255,255,255,0.92)' : '#1a1a1a',
          '--input-placeholder-color': isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.38)',
        } as React.CSSProperties
      }
    >
      <div className="chat-container">
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
    </div>
  )
}

export default App
