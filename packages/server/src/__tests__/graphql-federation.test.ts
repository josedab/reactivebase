import { describe, it, expect } from "vitest"
import {
  FederationGateway,
  FederationGatewayError,
} from "../graphql-federation/index.js"

describe("graphql-federation", () => {
  it("should export all expected symbols", () => {
    expect(FederationGateway).toBeDefined()
    expect(FederationGatewayError).toBeDefined()
  })

  it("should throw FederationGatewayError with correct message", () => {
    const error = new FederationGatewayError("gateway error")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("gateway error")
  })

  it("should construct a FederationGateway instance", () => {
    // TODO: test gateway construction with subgraph configs
    // TODO: test schema composition and conflict detection
    const gateway = new FederationGateway({})
    expect(gateway).toBeInstanceOf(FederationGateway)
  })
})
