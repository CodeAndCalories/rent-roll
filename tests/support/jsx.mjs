// Lets a node test import the app's .jsx components: registers a load hook
// that runs each .jsx file through Vite's own JSX transform (oxc), the same
// one the dev server and the build use. Nothing new is installed; nothing
// is written to disk. Import this before any .jsx import (dynamic imports
// after it), e.g.
//
//   import './support/jsx.mjs'
//   const { ActualPane } = await import('../src/components/SplitView.jsx')

import { register } from 'node:module'

register('./jsx-hooks.mjs', import.meta.url)
