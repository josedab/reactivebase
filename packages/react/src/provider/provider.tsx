/**
 * ReactiveBase React Provider - provides the client context to hooks.
 */

import { createContext, useContext, useMemo, useEffect, type ReactNode } from "react"
import {
  ReactiveBaseClient,
  type ReactiveBaseClientOptions,
  type ClientSubscriptionMiddleware,
} from "@reactivebase/client"

const ReactiveBaseContext = createContext<ReactiveBaseClient | null>(null)

export interface ReactiveBaseProviderProps {
  url: string
  token?: string
  /** Client-side subscription middleware pipeline */
  middleware?: ClientSubscriptionMiddleware[]
  children: ReactNode
}

export function ReactiveBaseProvider({ url, token, middleware, children }: ReactiveBaseProviderProps) {
  const client = useMemo(() => new ReactiveBaseClient({ url, token }), [url, token])

  useEffect(() => {
    return () => client.disconnect()
  }, [client])

  return <ReactiveBaseContext.Provider value={client}>{children}</ReactiveBaseContext.Provider>
}

export function useReactiveBaseClient(): ReactiveBaseClient {
  const client = useContext(ReactiveBaseContext)
  if (!client) {
    throw new Error("useReactiveBaseClient must be used within a <ReactiveBaseProvider>")
  }
  return client
}
