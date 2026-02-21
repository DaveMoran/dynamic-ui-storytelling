# RFC: Dynamic UI Storytelling App
**Status:** Draft
**Author:** TBD
**Date:** 2026-02-21
**Hackathon Context:** Local build target — no deployment concerns in scope

---

## 1. Problem Statement

Children ages 6–12 have vivid imaginations but limited tools that make storytelling feel alive. This app bridges the gap between typed narrative and visual experience: as a child types a story fragment, the interface transforms in real time — backgrounds shift, scene elements appear, and an AI co-author keeps the story moving forward. The result is an interactive, child-safe storytelling canvas that feels magical to use.

---

## 2. Goals

- **G1**: Provide a chat interface where a user types story fragments and the AI agent continues the story
- **G2**: Dynamically update the background (color gradients, sky states) based on parsed scene context
- **G3**: Load and position visual assets (trees, animals, weather, characters) from a local assets folder
- **G4**: Enforce child-safe content at all times — the AI softens dark/scary input into friendly alternatives
- **G5**: Run fully locally with a single `npm start` / `npm run dev` command

## Non-Goals

- **NG1**: Story persistence across sessions (no database)
- **NG2**: Deployment / hosting (post-hackathon)
- **NG3**: User accounts or authentication
- **NG4**: Mobile-responsive design (desktop first for hackathon)
- **NG5**: Multiplayer / real-time collaboration

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                     Browser (React)                      │
│                                                          │
│  ┌──────────────────┐    ┌────────────────────────────┐  │
│  │   Chat Panel     │    │      Scene Canvas          │  │
│  │                  │    │                            │  │
│  │  [Message Feed]  │    │  [Dynamic Background]      │  │
│  │  [Input Bar]     │    │  [Asset Layer (SVG/PNG)]   │  │
│  └────────┬─────────┘    └────────────────────────────┘  │
│           │  StoryContext (React Context + useReducer)   │
└───────────┼──────────────────────────────────────────────┘
            │ HTTP POST
┌───────────▼──────────────────────────────────────────────┐
│           Node/Express Proxy Server (local :3001)        │
│           • Holds ANTHROPIC_API_KEY securely             │
│           • Forwards requests to Claude API              │
│           • [Stretch] Redis character store              │
└───────────┬──────────────────────────────────────────────┘
            │
┌───────────▼──────────────┐
│   Anthropic Claude API   │
│   (claude-sonnet-4-6)    │
└──────────────────────────┘
```

**Why a local proxy server?**
Calling the Anthropic API directly from the browser exposes the API key in the client bundle. A thin Express server keeps the key server-side, takes ~30 minutes to set up, and is the right pattern even for a hackathon.

**Why React over Angular?**
React's component model and ecosystem (framer-motion, context API) maps cleanly to the dynamic, animation-heavy scene canvas. Angular adds overhead (modules, decorators, NgZone) that slows hackathon velocity.

---

## 4. Data Flow

```
User types story text
        │
        ▼
ChatPanel sends text to StoryContext
        │
        ▼
claudeService.js POSTs to /api/story (Express proxy)
        │
        ▼
Express forwards to Claude API with system prompt + conversation history
        │
        ▼
Claude returns structured JSON SceneDescriptor + story continuation text
        │
        ▼
StoryContext dispatches:
  - UPDATE_MESSAGES (appends AI story text to chat)
  - UPDATE_SCENE (new SceneDescriptor drives the canvas)
        │
        ▼
SceneCanvas re-renders:
  - Background component applies new gradient/sky
  - AssetLayer maps SceneDescriptor.assets → positioned asset components
```

---

## 5. AI Integration Design

### 5.1 System Prompt

```
You are a friendly, imaginative storytelling assistant for children ages 6–12.

RULES:
1. Always respond in two parts: a JSON scene descriptor block, then the story continuation.
2. Keep ALL content child-friendly. If the user writes something scary, dark, or violent, transform it into something whimsical and friendly (e.g., "monster" becomes a "fuzzy friendly giant").
3. Use vivid, simple language appropriate for young readers.
4. Keep story continuations to 2–4 sentences.
5. Characters you introduce should have names and brief descriptions.

RESPONSE FORMAT — always return exactly this structure:

<scene>
{
  "background": {
    "gradientStart": "#87CEEB",
    "gradientEnd": "#90EE90",
    "timeOfDay": "day",
    "weather": "sunny"
  },
  "assets": [
    { "type": "tree", "variant": "oak", "position": "left", "scale": 1.0 },
    { "type": "sun", "variant": "bright", "position": "top-right", "scale": 0.8 }
  ],
  "mood": "happy",
  "newCharacters": [
    { "name": "Lily", "description": "A curious girl with red pigtails" }
  ]
}
</scene>

Then write the story continuation as plain text after the closing </scene> tag.
```

### 5.2 SceneDescriptor Schema

```typescript
interface SceneDescriptor {
  background: {
    gradientStart: string;   // CSS hex color
    gradientEnd: string;     // CSS hex color
    timeOfDay: "dawn" | "day" | "dusk" | "night";
    weather: "sunny" | "cloudy" | "rainy" | "snowy" | "foggy" | "stormy";
  };
  assets: Array<{
    type: string;       // maps to asset folder (e.g. "tree", "cloud", "house")
    variant: string;    // specific asset file (e.g. "oak", "pine", "birch")
    position: "left" | "center" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
    scale: number;      // 0.5–2.0
  }>;
  mood: "happy" | "excited" | "calm" | "curious" | "silly";
  newCharacters: Array<{
    name: string;
    description: string;
  }>;
}
```

### 5.3 Background Color Palette

| Condition       | gradientStart | gradientEnd |
|----------------|--------------|------------|
| Sunny day      | `#87CEEB`    | `#90EE90`  |
| Dawn/dusk      | `#FFB347`    | `#FF6B6B`  |
| Night          | `#1a1a2e`    | `#16213E`  |
| Rainy          | `#708090`    | `#B0C4DE`  |
| Snowy          | `#E0F0FF`    | `#FFFFFF`  |
| Magical/silly  | `#DA70D6`    | `#FFD700`  |

---

## 6. Asset Organization

```
public/
└── assets/
    ├── nature/
    │   ├── trees/
    │   │   ├── oak.svg
    │   │   ├── pine.svg
    │   │   ├── birch.svg
    │   │   └── palm.svg
    │   ├── flowers/
    │   │   ├── daisy.svg
    │   │   └── sunflower.svg
    │   └── rocks/
    │       └── mossy-rock.svg
    ├── weather/
    │   ├── sun.svg
    │   ├── cloud.svg
    │   ├── rain-drop.svg
    │   ├── snowflake.svg
    │   └── rainbow.svg
    ├── animals/
    │   ├── bird.svg
    │   ├── butterfly.svg
    │   ├── bunny.svg
    │   ├── deer.svg
    │   └── cat.svg
    ├── buildings/
    │   ├── cottage.svg
    │   ├── treehouse.svg
    │   └── castle.svg
    └── characters/
        ├── child-boy.svg
        ├── child-girl.svg
        └── friendly-giant.svg
```

**Asset naming convention:** `{type}/{variant}.svg` — this maps directly to the `type` and `variant` fields in SceneDescriptor, enabling a simple dynamic import: `public/assets/{type}/{variant}.svg`.

**Asset style guidelines (for whoever creates/sources them):**
- Flat / cartoon style (not realistic)
- Bright, saturated colors
- No sharp edges or menacing features
- Transparent PNG or inline SVG preferred

---

## 7. Project File Structure

```
dynamic-ui-storytelling/
├── client/                          # React frontend
│   ├── public/
│   │   └── assets/                  # All visual assets (see §6)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatPanel/
│   │   │   │   ├── ChatPanel.jsx    # Message feed + input bar
│   │   │   │   └── MessageBubble.jsx
│   │   │   ├── SceneCanvas/
│   │   │   │   ├── SceneCanvas.jsx  # Full-screen scene wrapper
│   │   │   │   ├── Background.jsx   # Dynamic gradient background
│   │   │   │   └── AssetLayer.jsx   # Renders positioned asset images
│   │   │   └── LoadingIndicator.jsx
│   │   ├── context/
│   │   │   └── StoryContext.jsx     # Global state (messages, currentScene)
│   │   ├── hooks/
│   │   │   └── useStoryAI.js        # Calls /api/story, parses response
│   │   ├── services/
│   │   │   └── claudeService.js     # HTTP client to Express proxy
│   │   ├── utils/
│   │   │   └── sceneParser.js       # Extracts <scene>JSON</scene> from response
│   │   ├── constants/
│   │   │   └── assetManifest.js     # Enumeration of all valid asset type/variant combos
│   │   ├── App.jsx
│   │   ├── App.css
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js               # Proxy /api → localhost:3001
│
├── server/                          # Express proxy
│   ├── index.js                     # Express app entry
│   ├── routes/
│   │   └── story.js                 # POST /api/story handler
│   ├── services/
│   │   └── anthropic.js             # Anthropic SDK wrapper
│   └── package.json
│
├── .env                             # ANTHROPIC_API_KEY=sk-...
├── .gitignore
└── README.md
```

---

## 8. State Management

Using **React Context + useReducer** — no external state library needed.

```javascript
// StoryContext state shape
{
  messages: [
    { role: "user" | "assistant", content: string, timestamp: number }
  ],
  currentScene: SceneDescriptor | null,
  isLoading: boolean,
  characters: []   // populated by stretch goal
}

// Actions
UPDATE_MESSAGES   — append new message(s)
UPDATE_SCENE      — replace currentScene with new SceneDescriptor
SET_LOADING       — toggle loading state
ADD_CHARACTER     — stretch goal: track named characters
```

Scene transitions use **CSS transitions** on background gradient and **framer-motion** `<AnimatePresence>` for assets fading in/out smoothly.

---

## 9. Key Libraries

| Package | Purpose |
|---------|---------|
| `react`, `react-dom` | UI framework |
| `vite` | Dev server + bundler (faster than CRA) |
| `@anthropic-ai/sdk` | Claude API client (server-side) |
| `express` | Local proxy server |
| `cors` | Express CORS middleware |
| `dotenv` | Load .env in Express |
| `framer-motion` | Smooth asset enter/exit animations |
| `concurrently` | Run client + server with one command |

**Stretch goal additions:**
| Package | Purpose |
|---------|---------|
| `ioredis` | Redis client for character memory |
| `@copilotkit/react-core` | CopilotKit provider |
| `@copilotkit/react-ui` | CopilotKit chat UI components |

---

## 10. Stretch Goal Designs

### 10.1 Redis Dual State Memory (Character Biographies)

When the AI introduces a character (`newCharacters` in the scene response), the server stores a biography in Redis:

```
Key:   character:{storySessionId}:{characterName}
Value: { name, description, traits[], appearances[] }
TTL:   24 hours (session-scoped)
```

On each subsequent AI call, the server fetches all known characters for the session and injects them into the system prompt:

```
Known characters in this story:
- Lily: A curious girl with red pigtails. Traits: brave, kind.
- Captain Fluffybeard: A friendly pirate bear. Traits: jolly, clumsy.
```

This gives the AI continuity without a database — Redis acts as an ephemeral session store.

### 10.2 CopilotKit Integration

CopilotKit allows the AI to directly invoke React state changes via actions. Integration points:

- **`useCopilotAction("updateScene")`** — AI can call this action to push a new SceneDescriptor directly, bypassing the manual JSON parsing step
- **`useCopilotReadable`** — Expose `currentScene` and `messages` to the CopilotKit runtime so it has full story context
- The CopilotKit sidebar can replace the custom ChatPanel if the demo components fit the UX

CopilotKit is additive — the core app works without it, and it layers on top.

---

## 11. UI Layout

```
┌─────────────────────────────────────────────────────────┐
│                    Scene Canvas (70% height)             │
│                                                          │
│    [dynamic gradient background]                        │
│                                                          │
│   🌲          ☀️                    🌲                   │
│                                                          │
│        🐰           🏡                                   │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                    Chat Panel (30% height)               │
│                                                          │
│  AI: "Once upon a time, in a sunny meadow..."           │
│  You: "A bunny hopped over to the cottage"              │
│  AI: "The little bunny, whose name was Clover..."       │
│                                                          │
│  ┌─────────────────────────────────────────┐ [Send] │   │
│  │ Type your story here...                 │        │   │
│  └─────────────────────────────────────────┘        │   │
└─────────────────────────────────────────────────────────┘
```

---

## 12. Success Criteria (Hackathon Definition of Done)

- [ ] User can type a story fragment and receive an AI continuation in the chat
- [ ] Background gradient updates to match scene (at least 3 distinct states visible)
- [ ] At least 2–3 asset types render in the scene based on story context
- [ ] Assets animate in/out smoothly when scene changes
- [ ] All content remains child-friendly regardless of user input
- [ ] App starts with `npm run dev` (or equivalent single command) from the project root
- [ ] No API key is exposed in the client bundle

---

## 13. Open Questions & Risks

| # | Question / Risk | Proposed Resolution |
|---|----------------|---------------------|
| 1 | Where do child-safe SVG assets come from? | Source from free icon libraries (e.g., undraw.co, icons8 — free cartoon pack) or create minimal placeholder SVGs for hackathon demo |
| 2 | Claude API latency (1–3s per call) may feel slow | Show a typing indicator + animate existing scene while waiting; pre-generate a "title card" scene on app load |
| 3 | AI may not always return valid JSON in `<scene>` tags | `sceneParser.js` should have a fallback: if parse fails, keep the previous scene and only update the chat message |
| 4 | Asset `type/variant` mismatch (AI hallucinates an asset that doesn't exist) | `assetManifest.js` is the source of truth; `AssetLayer` silently skips unknown assets; include manifest in system prompt |
| 5 | Redis not available in hackathon environment | Redis stretch goal is explicitly optional; wrap all Redis calls in try/catch so app degrades gracefully |

---

## 14. Implementation Sequence (Suggested Hackathon Order)

1. **Scaffold** — `npm create vite@latest client -- --template react` + bare Express server + `concurrently` setup
2. **API Proxy** — `/api/story` route that calls Claude and returns raw response
3. **Chat Panel** — basic message input and feed UI
4. **Scene Parser** — `sceneParser.js` extracts JSON from `<scene>` tags
5. **Background** — `Background.jsx` reads SceneDescriptor and applies CSS gradient
6. **Asset Layer** — `AssetLayer.jsx` renders `<img>` tags from `public/assets/`
7. **Animations** — add framer-motion enter/exit to assets
8. **Polish** — child-friendly fonts, colors, loading states
9. **[Stretch]** Redis character memory
10. **[Stretch]** CopilotKit swap-in
