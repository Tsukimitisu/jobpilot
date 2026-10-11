import type { ReactNode } from 'react'
import { DiscoveryContext, useDiscoveryState } from './useDiscovery'

export function DiscoveryProvider({ children }: { children: ReactNode }) {
  const value = useDiscoveryState()
  return <DiscoveryContext.Provider value={value}>{children}</DiscoveryContext.Provider>
}
