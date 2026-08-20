export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';

export interface TaskMeta {
    id?: string;
    priority?: number;
    agent?: string;
    created_at?: string | number;
    updated_at?: string | number;
    mission_id?: string;
    workflow_id?: string;
}

export interface TaskPayload {
    user_message?: string;
    system_message?: string | null;
    model?: string;
    context?: Record<string, unknown> | null;
}

export interface DashboardTask {
    id: string;
    unified_status?: string;
    priority?: number;
    meta?: TaskMeta;
    spec?: { target?: string; model?: string; payload?: TaskPayload };
    result?: unknown;
    stage?: string;
    runtime_state?: string;
    blocked_reason?: string | null;
    blocked_details?: Record<string, unknown> | null;
    last_error?: string | null;
    command_caps?: {
        can_pause?: boolean;
        can_resume?: boolean;
        can_unblock?: boolean;
        can_retry?: boolean;
        can_cancel?: boolean;
        can_patch?: boolean;
        can_reassign_mission?: boolean;
    };
    mission_ref?: { id?: string; title?: string } | null;
    state?: {
        status?: string;
        quality_metrics?: { overall_score?: number; validation_passed?: boolean };
        [key: string]: unknown;
    };
    policy?: { dependencies?: string[]; [key: string]: unknown };
    mission?: { mission_id?: string };
    timestamps?: { updated_at_ms?: number; created_at_ms?: number };
    updated_at_ms?: number;
    mission_id?: string;
    spec_user_message_preview?: string;
    target?: string;
}

export interface MissionCounts {
    proposed?: number;
    pending?: number;
    running?: number;
    done?: number;
    failed?: number;
    blocked?: number;
}

export interface DashboardMission {
    id: string;
    title?: string;
    description?: string;
    status?: string;
    autonomy_mode?: string;
    counts?: MissionCounts;
    policy?: Record<string, unknown>;
    context?: {
        failure_reason?: string;
        feedback?: Array<{ text?: string; created_at?: string; author?: string; ts_ms?: number }>;
        [key: string]: unknown;
    };
    updated_at?: string;
    updated_at_ms?: number;
}

export interface DashboardProposal {
    id?: string;
    task_id?: string;
    title?: string;
    user_message?: string;
    status?: string;
    stage?: string;
    target?: string;
    spec_user_message_preview?: string;
    [key: string]: unknown;
}

export interface DashboardGraph {
    tasks?: DashboardTask[];
    nodes?: DashboardTask[];
    edges?: Array<{ depends_on_task_id: string; task_id: string }>;
    [key: string]: unknown;
}

export interface DashboardEvent {
    id?: string;
    type?: string;
    created_at?: string;
    entity_type?: string;
    entity_id?: string;
    ts_ms?: number;
    event_type?: string;
    payload?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface MissionProgressSelection {
    progress?: {
        percent?: number;
        current_step_index?: number;
        total_steps?: number;
        current_task_id?: string;
        blocked?: boolean;
        failure_reason?: string;
    } | null;
    live_counts?: {
        total?: number;
        proposed?: number;
        pending?: number;
        running?: number;
        done?: number;
        failed?: number;
        blocked?: number;
    } | null;
}

export interface TaskFiltersValue {
    status: string | null;
    priority: number | null;
    search: string;
}
