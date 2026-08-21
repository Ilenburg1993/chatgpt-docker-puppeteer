// @ts-check
/** JSDoc-only contracts for rollback execution. */
/** @typedef {{exists:boolean;contentHash:string|null;bytes:number|null}} RollbackPathState */
/** @typedef {'ready'|'pending'|'applied'|'failed'|'applied-but-unconfirmed'} RollbackExecutionStepStatus */
/** @typedef {{order:number;action:import('../contracts/index.js').IoChangeAction;target:string;status:RollbackExecutionStepStatus}} RollbackExecutionStep */
/** @typedef {{success:true;dryRun:boolean;status:'ready'|'applied';tokenId:string;changeSetId:string;appliedCount:number;steps:RollbackExecutionStep[]}} RollbackExecutionSuccess */
/** @typedef {{success:false;dryRun:boolean;status:'blocked'|'failed'|'partially-applied';tokenId:string;changeSetId:string;appliedCount:number;steps:RollbackExecutionStep[];error:string;code:string;mutationApplied?:true;mutationPhase?:string|null;mutationPaths?:string[]}} RollbackExecutionFailure */
/** @typedef {RollbackExecutionSuccess|RollbackExecutionFailure} RollbackExecutionResult */
export {};
