# Kubernetes Guestbook with Pulumi, Prometheus and Grafana

## Overview

This project deploys a Kubernetes Guestbook application using Pulumi and TypeScript, with Prometheus and Grafana for monitoring.

The monitoring stack is installed using the `kube-prometheus-stack` Helm chart.

### Architecture

- **Guestbook frontend:** PHP web application.
- **Redis leader and replicas:** Backend data services.
- **Pulumi:** Infrastructure provisioning using TypeScript.
- **Helm:** Installation of the monitoring stack.
- **Prometheus:** Metrics collection and querying.
- **Grafana:** Dashboards and visualization.
- **kube-state-metrics and node-exporter:** Kubernetes object and node metrics.

The Grafana dashboard includes Guestbook container CPU usage, memory usage, and container restart metrics.

## Prerequisites

Install and configure the following tools:

- Docker
- Kind
- kubectl
- Node.js and npm
- Pulumi CLI
- Helm 3

Ensure the Kubernetes cluster is running and accessible:

```bash
kubectl cluster-info
kubectl get nodes
```

Use the cluster name configured for this project, if applicable.

## Deploy the application

Clone the repository and enter the project directory:

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd k8s-guestbook
npm install
```

Select or create the Pulumi stack:

```bash
pulumi stack
```

If the stack does not exist yet:

```bash
pulumi stack init k8s-guestbook
```

Configure the Grafana administrator password as an encrypted Pulumi secret:

```bash
pulumi config set --secret grafanaAdminPassword "$(openssl rand -base64 24)"
```

If the project uses the optional configuration `useLoadBalancer`, configure it according to the Kubernetes environment. For a local Kind cluster, use the configuration expected by the project for ClusterIP services.

Validate the TypeScript code and preview the deployment:

```bash
npx tsc --noEmit
pulumi preview
```

Deploy the resources:

```bash
pulumi up
```

Review and confirm the proposed changes.

## Access Grafana

The Pulumi stack exports the following values:

- **URL:** `http://localhost:3000` when using port-forwarding.
- **Username:** `admin`.
- **Password:** The secret configured as `grafanaAdminPassword`.

Start port-forwarding:

```bash
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
```

Open:

http://localhost:3000

Retrieve the configured password locally, if necessary:

```bash
pulumi config get grafanaAdminPassword --show-secrets
```

Do not commit the actual password or share it in screenshots.

The Grafana Service is also configured with NodePort `32000`. Direct access through `http://localhost:32000` depends on the Kind networking configuration; port-forwarding is the documented access method.

## Access Prometheus

Start port-forwarding:

```bash
kubectl port-forward -n monitoring \
  svc/monitoring-kube-prometheus-prometheus 9091:9090
```

Open the Prometheus interface:

http://localhost:9091

To inspect discovered scrape targets:

http://localhost:9091/targets

Targets should show **UP** when they are healthy and successfully scraped.

## Verify Guestbook metrics

The project dashboard uses Prometheus metrics to monitor Guestbook container resources.

### 1. Verify CPU usage

Execute the following query in Prometheus:

```promql
sum by (pod) (
  rate(container_cpu_usage_seconds_total{
    namespace="default",
    pod=~"frontend-.*",
    container!="",
    container!="POD"
  }[5m])
)
```

### 2. Verify memory usage

```promql
sum by (pod) (
  container_memory_working_set_bytes{
    namespace="default",
    pod=~"frontend-.*",
    container!="",
    container!="POD"
  }
)
```

### 3. Verify container restarts

```promql
kube_pod_container_status_restarts_total{
  namespace="default",
  pod=~"frontend-.*|redis-leader-.*|redis-replica-.*"
}
```

The queries should return data when the corresponding metrics are available.

These queries validate container resource and Kubernetes state metrics. They do not, by themselves, demonstrate application-level HTTP request metrics.

## Verify Kubernetes resources

Check the Guestbook pods:

```bash
kubectl get pods -n default
```

Check the monitoring stack:

```bash
kubectl get pods -n monitoring
```

Check services:

```bash
kubectl get svc -n default
kubectl get svc -n monitoring
```

Check ServiceMonitors:

```bash
kubectl get servicemonitors -A
```

## Grafana dashboard

Open Grafana and navigate to **Dashboards**.

The Guestbook dashboard should display the configured CPU, memory, and container restart panels.

If a panel has no data, verify that the relevant Prometheus metrics exist and that the Prometheus targets are healthy.

## Cleanup

To remove resources managed by the active Pulumi stack:

```bash
pulumi destroy
```

Review the proposed deletions before confirming.

## Security

- Never commit real passwords, cloud credentials, or private keys.
- Store sensitive configuration using Pulumi secrets.
- Keep local configuration files and credentials out of version control.
- Review `.gitignore` before pushing the repository.

## Submission evidence

Include screenshots showing:

1. Successful `pulumi up`.
2. Guestbook and monitoring pods running.
3. Prometheus targets in the UP state.
4. Prometheus query results for Guestbook CPU and memory metrics.
5. The Guestbook dashboard displaying data in Grafana.
