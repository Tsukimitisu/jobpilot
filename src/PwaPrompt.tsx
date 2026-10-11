import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useOnline } from './workspace/useWorkspace'

export function PwaPrompt() {
  const online = useOnline()
  const [error, setError] = useState(false)
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({ onRegisterError: () => setError(true) })
  async function update() {
    if (!online || !window.confirm('Reload to apply the update? Save changes and finish uploads in every JobPilot tab first. Unsaved entries will be lost.')) return
    try { await updateServiceWorker(true) } catch { setError(true) }
  }
  if (!needRefresh && !error) return null
  return <section className="update-banner" aria-label="App update"><p role="status">{error ? 'Offline app support or the update could not start. You can keep using the website online; try again after saving your work and reloading.' : 'A JobPilot update is ready. Save your work before applying it.'}</p>
    {needRefresh && <div className="action-row"><button className="button" disabled={!online} onClick={() => void update()}>Apply update and reload</button><button className="button button-secondary" onClick={() => setNeedRefresh(false)}>Later</button></div>}
  </section>
}
