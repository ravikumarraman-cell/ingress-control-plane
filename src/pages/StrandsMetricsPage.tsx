import { StrandsExecutionMetricsDashboard } from "../components/dashboard/StrandsExecutionMetricsDashboard";
import { PageHeader } from "../components/ui/PageHeader";

export function StrandsMetricsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Strands Agents Telemetry & Execution Metrics"
        subtitle="Real-time Recharts observability across Strands SDK agent loops, read-only tool call latency, token consumption, and evaluation runs."
      />
      <StrandsExecutionMetricsDashboard />
    </div>
  );
}
