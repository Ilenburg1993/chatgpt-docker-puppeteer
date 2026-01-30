<template>
    <div class="line-chart-container">
        <canvas ref="chartCanvas"></canvas>
    </div>
</template>

<script>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import {
    Chart,
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    CategoryScale,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';

// Register Chart.js components
Chart.register(
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    CategoryScale,
    Title,
    Tooltip,
    Legend,
    Filler
);

export default {
    name: 'LineChart',
    props: {
        data: {
            type: Array,
            required: true,
            default: () => []
        },
        labels: {
            type: Array,
            default: () => []
        },
        label: {
            type: String,
            default: 'Value'
        },
        color: {
            type: String,
            default: '#3498db'
        },
        fillColor: {
            type: String,
            default: 'rgba(52, 152, 219, 0.1)'
        },
        yMin: {
            type: Number,
            default: null
        },
        yMax: {
            type: Number,
            default: null
        },
        showLegend: {
            type: Boolean,
            default: false
        },
        tension: {
            type: Number,
            default: 0.4
        },
        animated: {
            type: Boolean,
            default: true
        }
    },
    setup(props) {
        const chartCanvas = ref(null);
        let chartInstance = null;

        const createChart = () => {
            if (!chartCanvas.value) return;

            const ctx = chartCanvas.value.getContext('2d');

            // Generate labels if not provided
            const chartLabels = props.labels.length > 0
                ? props.labels
                : props.data.map((_, i) => i.toString());

            chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: chartLabels,
                    datasets: [{
                        label: props.label,
                        data: props.data,
                        borderColor: props.color,
                        backgroundColor: props.fillColor,
                        borderWidth: 2,
                        fill: true,
                        tension: props.tension,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: {
                        duration: props.animated ? 300 : 0
                    },
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    plugins: {
                        legend: {
                            display: props.showLegend
                        },
                        tooltip: {
                            enabled: true,
                            callbacks: {
                                label: (context) => {
                                    return `${props.label}: ${context.parsed.y.toFixed(2)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            display: true,
                            grid: {
                                display: false
                            },
                            ticks: {
                                maxTicksLimit: 6,
                                font: { size: 10 },
                                color: '#94a3b8'
                            }
                        },
                        y: {
                            display: true,
                            min: props.yMin,
                            max: props.yMax,
                            grid: {
                                color: 'rgba(148, 163, 184, 0.1)'
                            },
                            ticks: {
                                font: { size: 10 },
                                color: '#94a3b8'
                            }
                        }
                    }
                }
            });
        };

        const updateChart = () => {
            if (!chartInstance) return;

            const chartLabels = props.labels.length > 0
                ? props.labels
                : props.data.map((_, i) => i.toString());

            chartInstance.data.labels = chartLabels;
            chartInstance.data.datasets[0].data = props.data;
            chartInstance.update('none'); // No animation for real-time updates
        };

        // Watch for data changes
        watch(() => props.data, () => {
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
.line-chart-container {
    width: 100%;
    height: 100%;
    min-height: 200px;
}
</style>
