# ReactiveBase Kubernetes Deployment

## Helm Chart

Deploy ReactiveBase with a single command:

```bash
# Add the ReactiveBase Helm repo
helm repo add reactivebase https://charts.reactivebase.dev
helm repo update

# Install with default settings (includes Postgres + Redis)
helm install my-app reactivebase/reactivebase

# Install with custom values
helm install my-app reactivebase/reactivebase \
  --set postgresql.auth.postgresPassword=mypassword \
  --set replicaCount=3 \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=api.myapp.com

# Install from local chart
helm install my-app ./deploy/kubernetes/helm/reactivebase
```

### Configuration

Key configuration options in `values.yaml`:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of ReactiveBase replicas | `2` |
| `image.tag` | ReactiveBase image tag | `0.1.0` |
| `postgresql.enabled` | Deploy PostgreSQL | `true` |
| `redis.enabled` | Deploy Redis for pub/sub | `true` |
| `pgbouncer.enabled` | Deploy PgBouncer sidecar | `true` |
| `autoscaling.enabled` | Enable HPA | `true` |
| `autoscaling.maxReplicas` | Max pods | `10` |
| `serviceMonitor.enabled` | Prometheus ServiceMonitor | `false` |
| `migrations.enabled` | Auto-run migrations | `true` |

### Included Resources

- **Deployment** with health checks, resource limits, PgBouncer sidecar
- **Service** (ClusterIP)
- **Ingress** (optional, nginx)
- **HorizontalPodAutoscaler** with CPU, memory, and custom subscription metrics
- **PodDisruptionBudget** for zero-downtime rolling updates
- **ServiceMonitor** for Prometheus (optional)
- **ServiceAccount** with RBAC
- **Migration Job** (pre-install/pre-upgrade Helm hook)

## Kubernetes Operator (CRD)

For GitOps-native deployments, use the ReactiveBase CRD:

```yaml
apiVersion: reactivebase.dev/v1alpha1
kind: ReactiveBaseCluster
metadata:
  name: my-app
spec:
  replicas: 3
  image: ghcr.io/reactivebase/reactivebase:0.1.0
  postgres:
    version: "16"
    storage: 50Gi
    connectionPoolSize: 30
  redis:
    enabled: true
  scaling:
    minReplicas: 2
    maxReplicas: 10
    targetSubscriptions: 5000
  migrations:
    autoApply: true
  monitoring:
    prometheus: true
```

### Install the CRD

```bash
kubectl apply -f deploy/kubernetes/operator/crd.yaml
```

### Status Tracking

```bash
kubectl get reactivebaseclusters
# NAME     PHASE     READY   SUBSCRIPTIONS   AGE
# my-app   Running   3       12450           2d

kubectl describe rbc my-app
```
