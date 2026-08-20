<template>
    <div class="gauge-container">
        <canvas ref="chartCanvas"></canvas>
        <div class="gauge-value">
            <span class="value">{{ formattedValue }}</span>
            <span class="unit">{{ unit }}</span>
        </div>
        <div class="gauge-label">{{ label }}</div>
    </div>
</template>

<script lang="ts">
import { ArcElement, Chart, DoughnutController, Tooltip } from 'chart.js';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

// Register Chart.js components
Chart.register(DoughnutController, ArcElement, Tooltip);

export default {
    name: 'GaugeChart',
    props: {
        value: {
            type: Number,
            required: true,
            default: 0,
        },
        max: {
            type: Number,
            default: 100,
        },
        label: {
            type: String,
            default: '',
        },
        unit: {
            type: String,
            default: '%',
        },
        warningThreshold: {
            type: Number,
            default: 70,
        },
        criticalThreshold: {
            type: Number,
            default: 90,
        },
        colorHealthy: {
            type: String,
            default: '#22c55e',
        },
        colorWarning: {
            type: String,
            default: '#f59e0b',
        },
        colorCritical: {
            type: String,
            default: '#ef4444',
        },
        colorBackground: {
            type: String,
            default: '#e2e8f0',
        },
    },
    setup(props) {
        const chartCanvas = ref<HTMLCanvasElement | null>(null);
        let chartInstance: Chart<'doughnut', number[], string> | null = null;

        const formattedValue = computed(() => {
            return props.value.toFixed(1);
        });

        const currentColor = computed(() => {
            const percentage = (props.value / props.max) * 100;
            if (percentage >= props.criticalThreshold) return props.colorCritical;
            if (percentage >= props.warningThreshold) return props.colorWarning;
            return props.colorHealthy;
        });

        const createChart = () => {
            if (!chartCanvas.value) return;

            const ctx = chartCanvas.value.getContext('2d');
            if (!ctx) return;
            const percentage = Math.min((props.value / props.max) * 100, 100);
            const remaining = 100 - percentage;

            chartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    datasets: [
                        {
                            data: [percentage, remaining],
                            backgroundColor: [currentColor.value, props.colorBackground],
                            borderWidth: 0,
                            circumference: 270,
                            rotation: 225,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    cutout: '75%',
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false },
                    },
                    animation: {
                        duration: 500,
                    },
                },
            });
        };

        const updateChart = () => {
            if (!chartInstance) return;

            const percentage = Math.min((props.value / props.max) * 100, 100);
            const remaining = 100 - percentage;

            const dataset = chartInstance.data.datasets[0];
            if (!dataset) return;
            dataset.data = [percentage, remaining];
            dataset.backgroundColor = [currentColor.value, props.colorBackground];
            chartInstance.update('none');
        };

        watch(
            () => props.value,
            () => {
                updateChart();
            },
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
            formattedValue,
            currentColor,
        };
    },
};
</script>

<style scoped>
.gauge-container {
    position: relative;
    width: 100%;
    max-width: 200px;
    margin: 0 auto;
}

.gauge-value {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
}

.gauge-value .value {
    font-size: 1.8rem;
    font-weight: 700;
    color: #1e293b;
    display: block;
}

.gauge-value .unit {
    font-size: 0.9rem;
    color: #64748b;
}

.gauge-label {
    text-align: center;
    font-size: 0.85rem;
    color: #64748b;
    margin-top: -20px;
}
</style>
