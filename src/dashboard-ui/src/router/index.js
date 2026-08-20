// @ts-check
/** @import {RouteRecordRaw} from 'vue-router' */
import { createRouter, createWebHistory } from 'vue-router';

/** @type {RouteRecordRaw[]} */
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
    // === ROTAS DE AUDIT ===
    {
        path: '/audit',
        name: 'AuditDashboard',
        component: () => import('@/views/AuditView.vue'),
        meta: { title: 'Audit Agent' },
    },
    {
        path: '/audit/jobs',
        name: 'AuditJobs',
        component: () => import('@/views/AuditJobs.vue'),
        meta: { title: 'Jobs de Auditoria' },
    },
    {
        path: '/audit/jobs/:id',
        name: 'AuditJobDetail',
        component: () => import('@/views/AuditJobDetail.vue'),
        meta: { title: 'Detalhe do Job' },
    },
    {
        path: '/audit/patches/:id',
        name: 'AuditPatchDetail',
        component: () => import('@/views/AuditPatchDetail.vue'),
        meta: { title: 'Detalhe do Patch' },
    },
    {
        path: '/audit/inference',
        name: 'AuditInference',
        component: () => import('@/views/AuditInference.vue'),
        meta: { title: 'Inference Gateway' },
    },
    {
        path: '/:pathMatch(.*)*',
        name: 'NotFound',
        component: () => import('@/views/NotFound.vue'),
        meta: { title: '404 - Not Found' },
    },
];

/** Constante/valor exportado: default. */
const router = createRouter({
    history: createWebHistory('/dashboard/'),
    routes: /** @type {RouteRecordRaw[]} */ (routes),
});

// Navigation guards
router.beforeEach((to, _from, next) => {
    // Update document title
    document.title = to.meta['title'] ? `${to.meta['title']} - Mission Control` : 'Mission Control';
    next();
});

export default router;
