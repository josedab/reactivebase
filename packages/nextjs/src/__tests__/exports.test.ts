/**
 * Module export verification tests for @reactivebase/nextjs.
 */

import { describe, it, expect } from "vitest"

describe("module exports", () => {
  it("exports all core SSR functions", async () => {
    const mod = await import("../index.js")
    expect(typeof mod.preloadQuery).toBe("function")
    expect(typeof mod.preloadQueries).toBe("function")
    expect(typeof mod.usePreloadedQuery).toBe("function")
    expect(typeof mod.useStreamingQuery).toBe("function")
    expect(typeof mod.ReactiveBaseNextjsProvider).toBe("function")
    expect(typeof mod.isPreloadedQuery).toBe("function")
    expect(typeof mod.createQueryResource).toBe("function")
    expect(typeof mod.configurePagesRouter).toBe("function")
    expect(typeof mod.withServerSideQueries).toBe("function")
    expect(typeof mod.withStaticQueries).toBe("function")
  })

  it("exports new components and utilities", async () => {
    const mod = await import("../index.js")

    expect(mod.QueryErrorBoundary).toBeDefined()
    expect(mod.deduplicatedPreloadQuery).toBeDefined()
    expect(mod.revalidateReactiveBase).toBeDefined()
    expect(mod.revalidateReactiveBaseTags).toBeDefined()

    expect(mod.preloadQuery).toBeDefined()
    expect(mod.preloadQueries).toBeDefined()
    expect(mod.loadQuery).toBeDefined()
    expect(mod.createServerQueryClient).toBeDefined()
    expect(mod.createSubscriptionSeed).toBeDefined()
    expect(mod.ReactiveBaseNextjsProvider).toBeDefined()
    expect(mod.ReactiveIsland).toBeDefined()
    expect(mod.StreamingQueryBoundary).toBeDefined()
    expect(mod.StreamingPartialQuery).toBeDefined()
    expect(mod.ReactiveBaseSeededProvider).toBeDefined()
    expect(mod.usePreloadedQuery).toBeDefined()
    expect(mod.useStreamingQuery).toBeDefined()
    expect(mod.useServerQuery).toBeDefined()
    expect(mod.useSubscriptionSeed).toBeDefined()
    expect(mod.useSeededQuery).toBeDefined()
  })
})
