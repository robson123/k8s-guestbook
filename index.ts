import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

// Create only services of type `ClusterIP`
// for clusters that don't support `LoadBalancer` services
const config = new pulumi.Config();
const useLoadBalancer = config.getBoolean("useLoadBalancer");
const enableFrontendMetrics = config.getBoolean("enableFrontendMetrics") ?? false;
//
// REDIS LEADER.
//

const redisLeaderLabels = { app: "redis-leader" };
const redisLeaderDeployment = new k8s.apps.v1.Deployment("redis-leader", {
    spec: {
        selector: { matchLabels: redisLeaderLabels },
        template: {
            metadata: { labels: redisLeaderLabels },
            spec: {
                containers: [
                    {
                        name: "redis-leader",
                        image: "redis",
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        ports: [{ containerPort: 6379 }],
                    },
                ],
            },
        },
    },
});
const redisLeaderService = new k8s.core.v1.Service("redis-leader", {
    metadata: {
        name: "redis-leader",
        labels: redisLeaderDeployment.metadata.labels,
    },
    spec: {
        ports: [{ port: 6379, targetPort: 6379 }],
        selector: redisLeaderDeployment.spec.template.metadata.labels,
    },
});

//
// REDIS REPLICA.
//

const redisReplicaLabels = { app: "redis-replica" };
const redisReplicaDeployment = new k8s.apps.v1.Deployment("redis-replica", {
    spec: {
        selector: { matchLabels: redisReplicaLabels },
        template: {
            metadata: { labels: redisReplicaLabels },
            spec: {
                containers: [
                    {
                        name: "replica",
                        image: "guestbook-redis-replica:arm64",
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        // If your cluster config does not include a dns service, then to instead access an environment
                        // variable to find the leader's host, change `value: "dns"` to read `value: "env"`.
                        env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                        ports: [{ containerPort: 6379 }],
                    },
                ],
            },
        },
    },
});
const redisReplicaService = new k8s.core.v1.Service("redis-replica", {
    metadata: {
        name: "redis-replica",
        labels: redisReplicaDeployment.metadata.labels
    },
    spec: {
        ports: [{ port: 6379, targetPort: 6379 }],
        selector: redisReplicaDeployment.spec.template.metadata.labels,
    },
});

//
// FRONTEND
//

const frontendLabels = { app: "frontend" };
const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
    spec: {
        selector: { matchLabels: frontendLabels },
        replicas: 3,
        template: {
            metadata: { labels: frontendLabels },
            spec: {
                containers: [
                    {
                        name: "frontend",
                        image: "guestbook-php-redis:arm64",
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        // If your cluster config does not include a dns service, then to instead access an environment
                        // variable to find the leader's host, change `value: "dns"` to read `value: "env"`.
                        env: [{ name: "GET_HOSTS_FROM", value: "dns" /* value: "env"*/ }],
                        ports: [{ containerPort: 80 }],
                    },
                ],
            },
        },
    },
});
const frontendService = new k8s.core.v1.Service("frontend", {
    metadata: {
        labels: frontendDeployment.metadata.labels,
        name: "frontend",
    },
    spec: {
        type: useLoadBalancer ? "LoadBalancer" : "ClusterIP",
        ports: [{ port: 80 }],
        selector: frontendDeployment.spec.template.metadata.labels,
    },
});

// Export the frontend IP.
export let frontendIp: pulumi.Output<string>;
if (useLoadBalancer) {
    frontendIp = frontendService.status.loadBalancer.ingress[0].ip;
} else {
    frontendIp = frontendService.spec.clusterIP;
}
//
// MONITORING: PROMETHEUS AND GRAFANA
//

const grafanaAdminPassword = config.require("grafanaAdminPassword");

// Namespace dedicado ao monitoramento.
const monitoringNamespace = new k8s.core.v1.Namespace(
    "monitoring-namespace",
    {
        metadata: {
            name: "monitoring",
        },
    },
);

// Instala Prometheus, Grafana e os exporters do Kubernetes.
const monitoringStack = new k8s.helm.v3.Release(
    "monitoring-stack",
    {
        name: "monitoring",
        namespace: monitoringNamespace.metadata.name,
        createNamespace: false,
        chart: "kube-prometheus-stack",
        version: "69.8.2",
        repositoryOpts: {
            repo: ".",
        },
        values: {
            grafana: {
                enabled: true,
                adminUser: "admin",
                adminPassword: grafanaAdminPassword,
                service: {
                    type: "NodePort",
                    nodePort: 32000,
                },
                sidecar: {
                    dashboards: {
                        enabled: true,
                        label: "grafana_dashboard",
                        labelValue: "1",
                        searchNamespace: "ALL",
                    },
                },
            },
            prometheus: {
                enabled: true,
                service: {
                    type: "ClusterIP",
                },
                prometheusSpec: {
                    retention: "2d",
                },
            },
            alertmanager: {
                enabled: false,
            },
            // Componentes que podem não expor métricas
            // acessíveis no cluster Kind local.
            kubeEtcd: {
                enabled: false,
            },
            kubeControllerManager: {
                enabled: false,
            },
            kubeScheduler: {
                enabled: false,
            },
            kubeProxy: {
                enabled: false,
            },
        },
    },
    {
        dependsOn: [monitoringNamespace],
    },
);

// Dashboard inicial com métricas reais dos containers e Pods.
const guestbookDashboard = {
    title: "Guestbook Monitoring",
    uid: "guestbook-monitoring",
    timezone: "browser",
    schemaVersion: 39,
    version: 1,
    refresh: "30s",
    time: {
        from: "now-1h",
        to: "now",
    },
    panels: [
        {
            id: 1,
            title: "Frontend CPU Usage",
            type: "timeseries",
            datasource: {
                type: "prometheus",
                uid: "prometheus",
            },
            gridPos: {
                h: 8,
                w: 12,
                x: 0,
                y: 0,
            },
            targets: [
                {
                    refId: "A",
                    expr: 'sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="default",pod=~"frontend-.*",container!="",container!="POD"}[5m]))',
                    legendFormat: "{{pod}}",
                },
            ],
        },
        {
            id: 2,
            title: "Frontend Memory Usage",
            type: "timeseries",
            datasource: {
                type: "prometheus",
                uid: "prometheus",
            },
            gridPos: {
                h: 8,
                w: 12,
                x: 12,
                y: 0,
            },
            fieldConfig: {
                defaults: {
                    unit: "bytes",
                },
                overrides: [],
            },
            targets: [
                {
                    refId: "A",
                    expr: 'sum by (pod) (container_memory_working_set_bytes{namespace="default",pod=~"frontend-.*",container!="",container!="POD"})',
                    legendFormat: "{{pod}}",
                },
            ],
        },
        {
            id: 3,
            title: "Redis CPU Usage",
            type: "timeseries",
            datasource: {
                type: "prometheus",
                uid: "prometheus",
            },
            gridPos: {
                h: 8,
                w: 12,
                x: 0,
                y: 8,
            },
            targets: [
                {
                    refId: "A",
                    expr: 'sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="default",pod=~"redis-leader-.*|redis-replica-.*",container!="",container!="POD"}[5m]))',
                    legendFormat: "{{pod}}",
                },
            ],
        },
        {
            id: 4,
            title: "Guestbook Container Restarts",
            type: "timeseries",
            datasource: {
                type: "prometheus",
                uid: "prometheus",
            },
            gridPos: {
                h: 8,
                w: 12,
                x: 12,
                y: 8,
            },
            targets: [
                {
                    refId: "A",
                    expr: 'kube_pod_container_status_restarts_total{namespace="default",pod=~"frontend-.*|redis-leader-.*|redis-replica-.*"}',
                    legendFormat: "{{pod}}",
                },
            ],
        },
    ],
};

// O sidecar do Grafana detecta este ConfigMap pelo label.
const guestbookDashboardConfigMap = new k8s.core.v1.ConfigMap(
    "guestbook-grafana-dashboard",
    {
        metadata: {
            name: "guestbook-dashboard",
            namespace: monitoringNamespace.metadata.name,
            labels: {
                grafana_dashboard: "1",
            },
        },
        data: {
            "guestbook-dashboard.json": JSON.stringify(
                guestbookDashboard,
            ),
        },
    },
    {
        dependsOn: [monitoringStack],
    },
);

// Outputs para a entrega.
export const grafanaUrl = "http://localhost:3000";
export const grafanaNodePort = 32000;
export const grafanaAdminUser = "admin";
export const grafanaAdminPasswordOutput = pulumi.secret(
    grafanaAdminPassword,
);

function createRedisExporter(name: string, redisService: string) {
    const appLabel = `redis-exporter-${name}`;

    const deployment = new k8s.apps.v1.Deployment(
        `${appLabel}-deployment`,
        {
            metadata: {
                namespace: "default",
                labels: { app: appLabel },
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: { app: appLabel },
                },
                template: {
                    metadata: {
                        labels: { app: appLabel },
                    },
                    spec: {
                        containers: [
                            {
                                name: "redis-exporter",
                                image: "oliver006/redis_exporter:v1.74.0",
                                ports: [
                                    {
                                        name: "metrics",
                                        containerPort: 9121,
                                    },
                                ],
                                env: [
                                    {
                                        name: "REDIS_ADDR",
                                        value:
                                            `redis://${redisService}.default.svc.cluster.local:6379`,
                                    },
                                ],
                                readinessProbe: {
                                    httpGet: {
                                        path: "/metrics",
                                        port: 9121,
                                    },
                                    initialDelaySeconds: 5,
                                    periodSeconds: 10,
                                },
                            },
                        ],
                    },
                },
            },
        },
        { dependsOn: [monitoringStack] },
    );

    const service = new k8s.core.v1.Service(
        `${appLabel}-service`,
        {
            metadata: {
                namespace: "default",
                labels: { app: appLabel },
            },
            spec: {
                type: "ClusterIP",
                selector: { app: appLabel },
                ports: [
                    {
                        name: "metrics",
                        port: 9121,
                        targetPort: 9121,
                    },
                ],
            },
        },
        { dependsOn: [deployment] },
    );

    const serviceMonitor = new k8s.apiextensions.CustomResource(
        `${appLabel}-servicemonitor`,
        {
            apiVersion: "monitoring.coreos.com/v1",
            kind: "ServiceMonitor",
            metadata: {
                name: appLabel,
                namespace: "monitoring",
                labels: {
                    release: "monitoring",
                },
            },
            spec: {
                namespaceSelector: {
                    matchNames: ["default"],
                },
                selector: {
                    matchLabels: { app: appLabel },
                },
                endpoints: [
                    {
                        port: "metrics",
                        path: "/metrics",
                        interval: "30s",
                    },
                ],
            },
        },
        { dependsOn: [monitoringStack, service] },
    );

    return { deployment, service, serviceMonitor };
}

const redisLeaderMonitoring = createRedisExporter(
    "leader",
    "redis-leader",
);

const redisReplicaMonitoring = createRedisExporter(
    "replica",
    "redis-replica",
);

if (enableFrontendMetrics) {
    new k8s.apiextensions.CustomResource(
        "guestbook-frontend-servicemonitor",
        {
            apiVersion: "monitoring.coreos.com/v1",
            kind: "ServiceMonitor",
            metadata: {
                name: "guestbook-frontend",
                namespace: "monitoring",
                labels: {
                    release: "monitoring",
                },
            },
            spec: {
                namespaceSelector: {
                    matchNames: ["default"],
                },
                selector: {
                    matchLabels: {
                        app: "frontend",
                    },
                },
                endpoints: [
                    {
                        port: "http",
                        path: "/metrics",
                        interval: "30s",
                    },
                ],
            },
        },
        { dependsOn: [monitoringStack] },
    );
}
