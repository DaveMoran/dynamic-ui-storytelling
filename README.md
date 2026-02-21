# Dynamic UI Storytelling

Children ages 6–12 have vivid imaginations but limited tools that make storytelling feel alive. This app bridges the gap between typed narrative and visual experience: as a child types a story fragment, the interface transforms in real time — backgrounds shift, scene elements appear, and an AI co-author keeps the story moving forward. The result is an interactive, child-safe storytelling canvas that feels magical to use.

## Tech Stack
- React
- Vite
- LangChain
- Groq
- Typescript

## Versions

### v0.4
- Ability to use assets via emojis
- Support for multi-stop backgrounds

### V0.3
- Change background of story based on the prompts from the user
- Have chat "float" above the story so all elements are visible

### V0.2
- Optimize AI agent to focus on story
- Add limitation for story telling, including number of prompts and focus

### v0.1
- Add langchain to project
- Begin with free model (groq)
- Populate hello world screen with response from AI agent via Langchain

### v0.0
- Initial scaffolding from vite react

----

Deprecated

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```