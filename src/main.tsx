import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PwaPrompt } from './PwaPrompt'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PwaPrompt />
    <App />
  </StrictMode>,
)
