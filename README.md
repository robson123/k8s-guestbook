# Kubernetes Guestbook with Pulumi and Monitoring

## Overview

This project deploys the Kubernetes Guestbook application using Pulumi and TypeScript, with Prometheus and Grafana for monitoring.

## Architecture

- **Kubernetes:** Kind local cluster.
- **Infrastructure as Code:** Pulumi with TypeScript.
- **Application:** Guestbook frontend, Redis leader and Redis replicas.
- **Monitoring:** Prometheus, kube-state-metrics and node-exporter.
- **Visualization:** Grafana with a custom Guestbook dashboard.
- **Monitoring namespace:** `monitoring`.

## Prerequisites

- Docker
- Kind
- kubectl
- Helm
- Node.js and npm
- Pulumi CLI

## Deployment

Install the project dependencies:

```bash
npm install
```

Configure the Grafana administrator password as a Pulumi secret:

```bash
pulumi config set grafanaAdminPassword --secret
```

Enter the password when prompted.

Preview and deploy:

```bash
npx tsc --noEmit
pulumi preview
pulumi up
```

The local Helm chart `kube-prometheus-stack` must be available at the path configured in `index.ts`.

## Access

Start port forwarding in separate terminals:

```bash
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
```

Grafana: http://localhost:3000

```bash
kubectl port-forward -n monitoring svc/monitoring-kube-prometheus-prometheus 9090:9090
```

Prometheus: http://localhost:9090

Retrieve the Grafana password from Pulumi configuration:

```bash
pulumi config get grafanaAdminPassword --show-secrets
```

Username: `admin`

## Validation

Check application and monitoring resources:

```bash
kubectl get pods -n default
kubectl get pods -n monitoring
kubectl get svc -n monitoring
```

In Prometheus, use the `up` query and check target health.

Example queries:

```promql
rate(container_cpu_usage_seconds_total{namespace="default",container!=""}[5m])
```

```promql
container_memory_working_set_bytes{namespace="default",container!=""}
```

```promql
kube_pod_container_status_restarts_total{namespace="default"}
```

## Notes

This project is intended for local learning and experimentation. The Grafana NodePort and local port-forwarding are not a production access strategy. Do not commit secrets, kubeconfig files or generated Pulumi state.

