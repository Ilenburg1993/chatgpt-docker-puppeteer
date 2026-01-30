<!-- src/dashboard-ui/src/views/QualityDashboard.vue -->

<template>
  <div class="quality-dashboard">
    <h1>Quality Metrics</h1>

    <div class="metrics-grid">
      <!-- Overall Quality Score -->
      <metric-card
        title="Overall Quality Score"
        :value="metrics.overall_score"
        suffix="/100"
        :trend="metrics.score_trend"
        icon="star"
      />

      <!-- Validation Pass Rate -->
      <metric-card
        title="Validation Pass Rate"
        :value="metrics.pass_rate"
        suffix="%"
        :trend="metrics.pass_rate_trend"
        icon="check-circle"
      />

      <!-- Average Iterations -->
      <metric-card
        title="Avg Iterations to Pass"
        :value="metrics.avg_iterations"
        :trend="metrics.iterations_trend"
        icon="refresh"
      />

      <!-- Cost Efficiency -->
      <metric-card
        title="Cost per Passed Task"
        :value="metrics.cost_per_task"
        prefix="$"
        :trend="metrics.cost_trend"
        icon="dollar-sign"
      />
    </div>

    <div class="charts-row">
      <!-- Quality Score Over Time -->
      <chart-card title="Quality Score Over Time">
        <line-chart
          :data="qualityScoreHistory"
          :labels="timestamps"
          :options="{ min: 0, max: 100 }"
        />
      </chart-card>

      <!-- Validation Results Distribution -->
      <chart-card title="Validation Results">
        <bar-chart
          :data="validationDistribution"
          :labels="['Pass', 'Fail', 'Retry']"
        />
      </chart-card>
    </div>

    <div class="tasks-table">
      <h2>Recent Tasks with Quality Scores</h2>
      <data-table
        :columns="['Task ID', 'Strategy', 'Quality Score', 'Iterations', 'Cost', 'Status']"
        :rows="recentTasks"
        :sortable="true"
      >
        <template #quality_score="{ row }">
          <quality-badge :score="row.quality_score" />
        </template>
      </data-table>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useTelemetryStore } from '@/stores/telemetry';

export default {
  setup() {
    const telemetryStore = useTelemetryStore();

    const metrics = computed(() => telemetryStore.qualityMetrics);
    const qualityScoreHistory = computed(() => telemetryStore.qualityScoreHistory);
    const validationDistribution = computed(() => telemetryStore.validationDistribution);
    const recentTasks = computed(() => telemetryStore.recentTasksWithQuality);

    return {
      metrics,
      qualityScoreHistory,
      validationDistribution,
      recentTasks
    };
  }
};
</script>
