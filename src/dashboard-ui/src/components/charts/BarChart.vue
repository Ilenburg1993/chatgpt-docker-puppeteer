<template>
    <div class="bar-chart-container">
        <canvas ref="chartCanvas"></canvas>
    </div>
</template>

<script>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import {
    Chart,
    BarController,
    BarElement,
    LinearScale,
    CategoryScale,
    Title,
    Tooltip,
    Legend
} from 'chart.js';

// Register Chart.js components
Chart.register(
    BarController,
    BarElement,
    LinearScale,
    CategoryScale,
    Title,
    Tooltip,
    Legend
);

export default {
    name: 'BarChart',
    props: {
        data: {
            type: Array,
            required: true,
            default: () => []
        },
        labels: {
            type: Array,
            required: true,
            default: () => []
        },
        label: {
            type: String,
            default: 'Value'
        },
        colors: {
            type: Array,
            default: () => ['#3498db', '#2ecc71', '#f1c40f', '#e74c3c', '#9b59b6']
        },
        horizontal: {
            type: Boolean,
            default: false
        },
        showLegend: {
            type: Boolean,
            default: false
        }
    },
    setup(props) {
        const chartCanvas = ref(null);
        let chartInstance = null;

        const createChart = () => {
            if (!chartCanvas.value) return;

            const ctx = chartCanvas.value.getContext('2d');

            // Generate colors for each bar
            const backgroundColors = props.data.map((_, i) =>
                props.colors[i % props.colors.length]
            );

            chartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: props.labels,
                    datasets: [{
                        label: props.label,
                        data: props.data,
                        backgroundColor: backgroundColors,
                        borderWidth: 0,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: props.horizontal ? 'y' : 'x',
                    plugins: {
                        legend: {
                            display: props.showLegend
                        },
                        tooltip: {
                            enabled: true
                        }
                    },
                    scales: {
                        x: {
                            grid: {
                                display: !props.horizontal
                            },
                            ticks: {
                                font: { size: 11 },
                                color: '#64748b'
                            }
                        },
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(148, 163, 184, 0.1)'
                            },
                            ticks: {
                                font: { size: 11 },
                                color: '#64748b'
                            }
                        }
                    }
                }
            });
        };

        const updateChart = () => {
            if (!chartInstance) return;

            const backgroundColors = props.data.map((_, i) =>
                props.colors[i % props.colors.length]
            );

            chartInstance.data.labels = props.labels;
            chartInstance.data.datasets[0].data = props.data;
            chartInstance.data.datasets[0].backgroundColor = backgroundColors;
            chartInstance.update('none');
        };

        watch([() => props.data, () => props.labels], () => {
            updateChart();
        }, { deep: true });

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
            chartCanvas
        };
    }
};
</script>

<style scoped>
.bar-chart-container {
    width: 100%;
    height: 100%;
    min-height: 200px;
}
</style>
