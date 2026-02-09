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
        meta: { title: 'Visão geral' },
    },
    {
        path: '/tasks',
        name: 'Tasks',
        component: () => import('@/views/TasksView.vue'),
        meta: { title: 'Tarefas' },
    },
    {
        path: '/tasks/:id',
        name: 'TaskDetail',
        component: () => import('@/views/TaskDetail.vue'),
        meta: { title: 'Detalhe da tarefa' },
    },
    {
        path: '/missions',
        name: 'Missions',
        component: () => import('@/views/Missions.vue'),
        meta: { title: 'Missões' },
    },
    {
        path: '/missions/:id',
        name: 'MissionDetail',
        component: () => import('@/views/MissionDetail.vue'),
        meta: { title: 'Detalhe da missão' },
    },
    {
        path: '/events',
        name: 'EventCorrelation',
        component: () => import('@/views/EventCorrelation.vue'),
        meta: { title: 'Eventos' },
    },
    {
        path: '/workflows/:workflowId',
        name: 'WorkflowView',
        component: () => import('@/views/WorkflowView.vue'),
        meta: { title: 'Workflow' },
    },
    {
        path: '/artifacts/:id',
        name: 'ArtifactView',
        component: () => import('@/views/ArtifactView.vue'),
        meta: { title: 'Artefato' },
    },
    {
        path: '/health',
        name: 'SystemHealth',
        component: () => import('@/views/SystemHealth.vue'),
        meta: { title: 'Saúde do sistema' },
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
