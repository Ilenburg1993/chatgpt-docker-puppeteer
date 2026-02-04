import { createRouter, createWebHistory } from 'vue-router';

const routes = [
    {
        path: '/',
        redirect: '/dashboard',
    },
    {
        path: '/dashboard',
        name: 'Dashboard',
        component: () => import('@/views/DashboardView.vue'),
        meta: { title: 'Mission Control Dashboard' },
    },
    {
        path: '/dashboard-old',
        name: 'DashboardOld',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: 'Mission Control Dashboard (Legacy)' },
    },
    {
        path: '/tasks',
        name: 'Tasks',
        component: () => import('@/views/TasksView.vue'),
        meta: { title: 'Tasks' },
    },
    {
        path: '/tasks-old',
        name: 'TaskQueue',
        component: () => import('@/views/TaskQueue.vue'),
        meta: { title: 'Task Queue (Legacy)' },
    },
    {
        path: '/tasks/:id',
        name: 'TaskDetail',
        component: () => import('@/views/TaskDetail.vue'),
        meta: { title: 'Task Details' },
    },
    {
        path: '/workflow',
        name: 'WorkflowEditor',
        component: () => import('@/views/WorkflowEditor.vue'),
        meta: { title: 'Workflow Editor' },
    },
    {
        path: '/metrics',
        name: 'PerformanceMetrics',
        component: () => import('@/views/PerformanceMetrics.vue'),
        meta: { title: 'Performance Metrics' },
    },
    {
        path: '/events',
        name: 'EventCorrelation',
        component: () => import('@/views/EventCorrelation.vue'),
        meta: { title: 'Event Correlation' },
    },
    {
        path: '/health',
        name: 'SystemHealth',
        component: () => import('@/views/SystemHealth.vue'),
        meta: { title: 'System Health' },
    },
    {
        path: '/templates',
        name: 'Templates',
        component: () => import('@/views/Templates.vue'),
        meta: { title: 'Mission Templates' },
    },
    {
        path: '/missions',
        name: 'Missions',
        component: () => import('@/views/Missions.vue'),
        meta: { title: 'Missions' },
    },
    {
        path: '/missions/:id',
        name: 'MissionDetail',
        component: () => import('@/views/MissionDetail.vue'),
        meta: { title: 'Mission Details' },
    },
    {
        path: '/:pathMatch(.*)*',
        name: 'NotFound',
        component: () => import('@/views/NotFound.vue'),
        meta: { title: '404 - Not Found' },
    },
];

const router = createRouter({
    history: createWebHistory('/dashboard/'),
    routes
});

// Navigation guards
router.beforeEach((to, from, next) => {
    // Update document title
    document.title = to.meta.title ? `${to.meta.title} - Mission Control` : 'Mission Control';
    next();
});

export default router;
