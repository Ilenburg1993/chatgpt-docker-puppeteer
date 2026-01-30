<!-- src/dashboard-ui/src/views/WorkflowDesigner.vue -->

<template>
  <div class="workflow-designer">
    <div class="toolbar">
      <button @click="addStep('execute_prompt')">Add Prompt Step</button>
      <button @click="addStep('validate')">Add Validation Step</button>
      <button @click="addStep('branch')">Add Branch</button>
      <button @click="validateWorkflow">Validate Workflow</button>
      <button @click="saveWorkflow" :disabled="!isValid">Save Workflow</button>
      <button @click="executeWorkflow" :disabled="!isValid" class="primary">Execute</button>
    </div>

    <div class="canvas-area">
      <!-- Cytoscape.js canvas for visual DAG -->
      <cytoscape
        ref="cytoscapeRef"
        :config="cytoscapeConfig"
        :elements="workflowSteps"
        @node-click="editStep"
        @edge-click="editDependency"
      />
    </div>

    <div class="step-editor" v-if="selectedStep">
      <h3>Edit Step: {{ selectedStep.name }}</h3>
      <form @submit.prevent="saveStep">
        <div class="form-group">
          <label>Step Name</label>
          <input v-model="selectedStep.name" required />
        </div>

        <div class="form-group">
          <label>Action Type</label>
          <select v-model="selectedStep.action">
            <option value="execute_prompt">Execute Prompt</option>
            <option value="validate">Validate</option>
            <option value="branch">Branch</option>
            <option value="spawn_subtask">Spawn Subtask</option>
          </select>
        </div>

        <div class="form-group" v-if="selectedStep.action === 'execute_prompt'">
          <label>Prompt Template</label>
          <textarea v-model="selectedStep.config.prompt" rows="10"></textarea>
          <small>Use {step_id} to reference previous step results</small>
        </div>

        <div class="form-group">
          <label>Dependencies</label>
          <multiselect
            v-model="selectedStep.dependencies"
            :options="availableSteps"
            multiple
            label="name"
            track-by="id"
          />
        </div>

        <div class="form-group">
          <label>On Failure</label>
          <select v-model="selectedStep.on_failure">
            <option value="abort">Abort Workflow</option>
            <option value="retry">Retry Step</option>
            <option value="skip">Skip and Continue</option>
          </select>
        </div>

        <div class="form-actions">
          <button type="submit" class="primary">Save Step</button>
          <button type="button" @click="deleteStep">Delete Step</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue';
import { useWorkflowStore } from '@/stores/workflow';

export default {
  setup() {
    const workflowStore = useWorkflowStore();

    const selectedStep = ref(null);
    const workflowSteps = computed(() => workflowStore.currentWorkflow?.steps || []);
    const isValid = computed(() => workflowStore.workflowValidation?.valid || false);

    const addStep = (actionType) => {
      const newStep = {
        id: `step-${Date.now()}`,
        name: `New ${actionType} Step`,
        action: actionType,
        config: {},
        dependencies: [],
        on_failure: 'abort'
      };

      workflowStore.addStep(newStep);
    };

    const editStep = (stepId) => {
      selectedStep.value = workflowStore.getStep(stepId);
    };

    const saveStep = () => {
      workflowStore.updateStep(selectedStep.value);
      selectedStep.value = null;
    };

    const deleteStep = () => {
      workflowStore.deleteStep(selectedStep.value.id);
      selectedStep.value = null;
    };

    const validateWorkflow = async () => {
      await workflowStore.validateWorkflow();
    };

    const saveWorkflow = async () => {
      await workflowStore.saveWorkflow();
    };

    const executeWorkflow = async () => {
      await workflowStore.executeWorkflow();
    };

    return {
      selectedStep,
      workflowSteps,
      isValid,
      addStep,
      editStep,
      saveStep,
      deleteStep,
      validateWorkflow,
      saveWorkflow,
      executeWorkflow
    };
  }
};
</script>
