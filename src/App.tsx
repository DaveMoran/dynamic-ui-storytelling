import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [story, setStory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/hello')
      .then(r => r.json())
      .then((data: { message: string }) => {
        setStory(data.message)
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to connect to the story server. Is it running?')
        setLoading(false)
      })
  }, [])

  return (
    <div className="app">
      <h1>✨ Dynamic Story World</h1>
      {loading && <p className="loading">Summoning your story...</p>}
      {error && <p className="error">{error}</p>}
      {story && <p className="story">{story}</p>}
    </div>
  )
}

export default App
