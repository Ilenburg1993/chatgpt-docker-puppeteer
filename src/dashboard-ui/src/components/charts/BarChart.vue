<template>
    <div class="bar-chart-container">
        <canvas ref="chartCanvas"></canvas>
    </div>
</template>

<script lang="ts">
import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, Title, Tooltip } from 'chart.js';
import { onMounted, onUnmounted, ref, watch, type PropType } from 'vue';

// Register Chart.js components
Chart.register(BarController, BarElement, LinearScale, CategoryScale, Title, Tooltip, Legend);

export default {
    name: 'BarChart',
    props: {
        data: {
            type: Array as PropType<number[]>,
            required: true,
            default: () => [],
        },
        labels: {
            type: Array as PropType<string[]>,
            required: true,
            default: () => [],
        },
        label: {
            type: String,
            default: 'Value',
        },
        colors: {
            type: Array as PropType<string[]>,
            default: () => ['#3498db', '#2ecc71', '#f1c40f', '#e74c3c', '#9b59b6'],
        },
        horizontal: {
            type: Boolean,
            default: false,
        },
        showLegend: {
            type: Boolean,
            default: false,
        },
    },
    setup(props) {
        const chartCanvas = ref<HTMLCanvasElement | null>(null);
        let chartInstance: Chart<'bar', number[], string> | null = null;

        const createChart = () => {
            if (!chartCanvas.value) return;

            const ctx = chartCanvas.value.getContext('2d');
            if (!ctx) return;

            // Generate colors for each bar
            const backgroundColors = props.data.map((_, i) => props.colors[i % props.colors.length] ?? '#3498db');

            chartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: props.labels,
                    datasets: [
                        {
                            label: props.label,
                            data: props.data,
                            backgroundColor: backgroundColors,
                            borderWidth: 0,
                            borderRadius: 4,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: props.horizontal ? 'y' : 'x',
                    plugins: {
                        legend: {
                            display: props.showLegend,
                        },
                        tooltip: {
                            enabled: true,
                        },
                    },
                    scales: {
                        x: {
                            grid: {
                                display: !props.horizontal,
                            },
                            ticks: {
                                font: { size: 11 },
                                color: '#64748b',
                            },
                        },
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(148, 163, 184, 0.1)',
                            },
                            ticks: {
                                font: { size: 11 },
                                color: '#64748b',
                            },
                        },
                    },
                },
            });
        };

        const updateChart = () => {
            if (!chartInstance) return;

            const backgroundColors = props.data.map((_, i) => props.colors[i % props.colors.length] ?? '#3498db');

            chartInstance.data.labels = props.labels;
            const dataset = chartInstance.data.datasets[0];
            if (!dataset) return;
            dataset.data = props.data;
            dataset.backgroundColor = backgroundColors;
            chartInstance.update('none');
        };

        watch(
            [() => props.data, () => props.labels],
            () => {
                updateChart();
            },
            { deep: true },
        );

        onMounted(() => {
            createChart();
        });

        onUnmounted(() => {
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }
        });

        return {
            chartCanvas,
        };
    },
};
</script>

<style scoped>
.bar-chart-container {
    width: 100%;
    height: 100%;
    min-height: 200px;
}
</style>
