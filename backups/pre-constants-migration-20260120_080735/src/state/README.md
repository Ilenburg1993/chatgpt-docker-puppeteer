# State Persistence Directory

This directory contains runtime state for system components:

- **tasks/** - Active and completed task state
- **workflows/** - Workflow execution state and checkpoints
- **memory/** - Episodic memory storage (level 2)
- **kernel/** - Kernel runtime state and policies

State files use JSON format with atomic writes for reliability.
