/**
 * Multi-tab subscription deduplication via BroadcastChannel.
 * Elects a "leader" tab that owns the WebSocket connection.
 * Other tabs send subscribe/mutate requests through the leader.
 */

export interface TabMessage {
  type: "leader_claim" | "leader_ack" | "subscribe" | "unsubscribe" | "update" | "ping"
  tabId: string
  payload?: unknown
}

export type TabRole = "leader" | "follower" | "electing"

export class MultiTabCoordinator {
  private channel: BroadcastChannelLike | null = null
  private tabId: string
  private role: TabRole = "electing"
  private leaderTabId: string | null = null
  private electionTimer: ReturnType<typeof setTimeout> | null = null
  private updateHandlers = new Set<(data: unknown) => void>()

  constructor(
    private channelName: string = "reactivebase_tabs",
    channelFactory?: () => BroadcastChannelLike,
  ) {
    this.tabId = `tab_${Math.random().toString(36).substring(2, 8)}_${Date.now()}`

    if (channelFactory) {
      this.channel = channelFactory()
    } else if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(channelName) as unknown as BroadcastChannelLike
    }

    if (this.channel) {
      this.channel.onmessage = (event: { data: unknown }) => {
        this.handleMessage(event.data as TabMessage)
      }
    }
  }

  /**
   * Start the coordinator and run leader election.
   */
  async elect(): Promise<TabRole> {
    if (!this.channel) {
      this.role = "leader"
      return this.role
    }

    // Claim leadership
    this.broadcast({ type: "leader_claim", tabId: this.tabId })

    // Wait for competing claims
    return new Promise((resolve) => {
      this.electionTimer = setTimeout(() => {
        if (this.role === "electing") {
          this.role = "leader"
          this.broadcast({ type: "leader_ack", tabId: this.tabId })
        }
        resolve(this.role)
      }, 100 + Math.random() * 50)
    })
  }

  /**
   * Register a handler for subscription updates (used by follower tabs).
   */
  onUpdate(handler: (data: unknown) => void): () => void {
    this.updateHandlers.add(handler)
    return () => this.updateHandlers.delete(handler)
  }

  /**
   * Broadcast a subscription update to all tabs (used by leader).
   */
  broadcastUpdate(subscriptionId: string, data: unknown, version: number): void {
    this.broadcast({
      type: "update",
      tabId: this.tabId,
      payload: { subscriptionId, data, version },
    })
  }

  /**
   * Close the coordinator.
   */
  close(): void {
    if (this.electionTimer) clearTimeout(this.electionTimer)
    if (this.channel && "close" in this.channel) {
      (this.channel as { close(): void }).close()
    }
    this.channel = null
  }

  get currentRole(): TabRole {
    return this.role
  }

  get id(): string {
    return this.tabId
  }

  private handleMessage(msg: TabMessage): void {
    if (msg.tabId === this.tabId) return

    switch (msg.type) {
      case "leader_claim":
        // Another tab is claiming leadership
        if (this.role === "electing") {
          // If their ID is "greater", they win
          if (msg.tabId > this.tabId) {
            this.role = "follower"
            this.leaderTabId = msg.tabId
            if (this.electionTimer) clearTimeout(this.electionTimer)
          }
        }
        break

      case "leader_ack":
        if (this.role === "electing") {
          this.role = "follower"
          this.leaderTabId = msg.tabId
          if (this.electionTimer) clearTimeout(this.electionTimer)
        }
        break

      case "update":
        for (const handler of this.updateHandlers) {
          handler(msg.payload)
        }
        break
    }
  }

  private broadcast(msg: TabMessage): void {
    this.channel?.postMessage(msg)
  }
}

/**
 * Minimal BroadcastChannel interface for loose coupling.
 */
export interface BroadcastChannelLike {
  postMessage(message: unknown): void
  onmessage: ((event: { data: unknown }) => void) | null
}
