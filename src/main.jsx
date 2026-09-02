import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { registerServiceWorker } from './lib/sw.js'

// Offline shell. Production only, and it never takes over on its own: a
// waiting build shows "Update available — reload" (UpdatePrompt.jsx).
registerServiceWorker()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
