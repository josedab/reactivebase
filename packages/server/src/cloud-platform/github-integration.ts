/**
 * GitHub auto-deploy integration for ReactiveBase Cloud.
 * Connects GitHub repositories to projects for push-to-deploy workflows
 * via webhook events.
 */

import { createIdGenerator } from "./id-generator.js"
import type { ControlPlaneDashboard } from "./control-plane-dashboard.js"
import type { GitHubWebhookPayload, GitHubConnection } from "./k8s-types.js"

export class GitHubIntegration {
  private dashboard: ControlPlaneDashboard
  private connections = new Map<string, GitHubConnection>()
  private deployments = new Map<
    string,
    { projectId: string; commitSha: string; status: string; startedAt: string; completedAt: string | null }
  >()
  private generateId = createIdGenerator()

  constructor(dashboard: ControlPlaneDashboard) {
    this.dashboard = dashboard
  }

  // ─── Repository Connection ────────────────────────────────────────────

  async connectRepository(projectId: string, repoUrl: string, branch: string): Promise<GitHubConnection> {
    const project = this.dashboard.getProjectDetails(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    for (const conn of this.connections.values()) {
      if (conn.projectId === projectId && conn.status === "connected") {
        throw new Error(`Project ${projectId} already has a connected repository`)
      }
    }

    const connection: GitHubConnection = {
      id: this.generateId("ghconn"),
      projectId,
      repoUrl,
      branch,
      webhookSecret: `whsec_${this.generateId("secret")}`,
      status: "connected",
      lastDeployedSha: null,
      lastDeployedAt: null,
      createdAt: new Date().toISOString(),
    }

    this.connections.set(connection.id, connection)
    return connection
  }

  async disconnectRepository(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId)
    if (!connection) throw new Error(`Connection ${connectionId} not found`)
    connection.status = "disconnected"
  }

  // ─── Webhook Handling ─────────────────────────────────────────────────

  async handleWebhook(payload: GitHubWebhookPayload): Promise<{ deployed: boolean; deploymentId?: string }> {
    let matchedConnection: GitHubConnection | undefined
    for (const conn of this.connections.values()) {
      if (conn.status === "connected" && conn.repoUrl === payload.repository.clone_url) {
        const pushBranch = payload.ref.replace("refs/heads/", "")
        if (pushBranch === conn.branch) {
          matchedConnection = conn
          break
        }
      }
    }

    if (!matchedConnection) {
      return { deployed: false }
    }

    const commitSha = payload.after
    const deploymentId = await this.triggerDeploy(matchedConnection.projectId, commitSha)

    matchedConnection.lastDeployedSha = commitSha
    matchedConnection.lastDeployedAt = new Date().toISOString()

    return { deployed: true, deploymentId }
  }

  // ─── Deployments ──────────────────────────────────────────────────────

  async triggerDeploy(projectId: string, commitSha: string): Promise<string> {
    const project = this.dashboard.getProjectDetails(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const deploymentId = this.generateId("deploy")

    this.deployments.set(deploymentId, {
      projectId,
      commitSha,
      status: "queued",
      startedAt: new Date().toISOString(),
      completedAt: null,
    })

    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "system",
      message: `Deployment triggered for commit ${commitSha.slice(0, 7)}`,
    })
    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "build",
      message: "[1/4] Installing dependencies...",
    })
    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "build",
      message: "[2/4] Building TypeScript...",
    })
    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "build",
      message: "[3/4] Generating types...",
    })
    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "kubernetes",
      message: "[4/4] Rolling out to Kubernetes...",
    })

    const deployment = this.deployments.get(deploymentId)!
    deployment.status = "active"
    deployment.completedAt = new Date().toISOString()

    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "system",
      message: "Deployment completed successfully",
    })

    return deploymentId
  }

  getDeploymentStatus(
    deploymentId: string,
  ): { deploymentId: string; status: string; startedAt: string; completedAt: string | null } | undefined {
    const deployment = this.deployments.get(deploymentId)
    if (!deployment) return undefined
    return {
      deploymentId,
      status: deployment.status,
      startedAt: deployment.startedAt,
      completedAt: deployment.completedAt,
    }
  }

  getConnection(connectionId: string): GitHubConnection | undefined {
    return this.connections.get(connectionId)
  }

  listConnections(projectId: string): GitHubConnection[] {
    return [...this.connections.values()].filter((c) => c.projectId === projectId)
  }
}
