# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Auto-Build is a multi-agent autonomous coding framework that builds software through coordinated AI agent sessions. It uses the Claude Code SDK to run agents in isolated workspaces with security controls.

## Commands

### Setup
```bash
# Install dependencies (from auto-build/)
uv venv && uv pip install -r requirements.txt
# Or: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt

# Set up OAuth token
claude setup-token
# Add to auto-build/.env: CLAUDE_CODE_OAUTH_TOKEN=your-token
```

### Creating and Running Specs
```bash
# Create a spec interactively
python auto-build/spec_runner.py --interactive

# Create spec from task description
python auto-build/spec_runner.py --task "Add user authentication"

# Force complexity level (simple/standard/complex)
python auto-build/spec_runner.py --task "Fix button" --complexity simple

# Run autonomous build
python auto-build/run.py --spec 001

# Run with parallel workers
python auto-build/run.py --spec 001 --parallel 2

# List all specs
python auto-build/run.py --list
```

### Workspace Management
```bash
# Review changes in isolated worktree
python auto-build/run.py --spec 001 --review

# Merge completed build into project
python auto-build/run.py --spec 001 --merge

# Discard build
python auto-build/run.py --spec 001 --discard
```

### QA Validation
```bash
# Run QA manually
python auto-build/run.py --spec 001 --qa

# Check QA status
python auto-build/run.py --spec 001 --qa-status
```

### Testing
```bash
# Run all tests
pytest tests/ -v

# Run single test file
pytest tests/test_security.py -v

# Run specific test
pytest tests/test_security.py::test_bash_command_validation -v

# Skip slow tests
pytest tests/ -m "not slow"
```

### Spec Validation
```bash
python auto-build/validate_spec.py --spec-dir auto-build/specs/001-feature --checkpoint all
```

## Architecture

### Core Pipeline

**Spec Creation (spec_runner.py)** - Dynamic 3-8 phase pipeline based on task complexity:
- SIMPLE (3 phases): Discovery → Quick Spec → Validate
- STANDARD (6-7 phases): Discovery → Requirements → [Research] → Context → Spec → Plan → Validate
- COMPLEX (8 phases): Full pipeline with Research and Self-Critique phases

**Implementation (run.py → agent.py)** - Multi-session build:
1. Planner Agent creates chunk-based implementation plan
2. Coder Agent implements chunks one-by-one
3. QA Reviewer validates acceptance criteria
4. QA Fixer resolves issues in a loop

### Key Components

- **client.py** - Claude SDK client with security hooks and tool permissions
- **security.py** + **project_analyzer.py** - Dynamic command allowlisting based on detected project stack
- **worktree.py** - Git worktree isolation for safe parallel builds
- **coordinator.py** - Parallel execution coordinator
- **memory.py** - File-based session memory
- **graphiti_memory.py** - Optional graph-based cross-session memory (requires FalkorDB)
- **linear_updater.py** - Optional Linear integration for progress tracking

### Agent Prompts (auto-build/prompts/)

| Prompt | Purpose |
|--------|---------|
| planner.md | Creates implementation plan with chunks |
| coder.md | Implements individual chunks |
| coder_recovery.md | Recovers from stuck/failed chunks |
| qa_reviewer.md | Validates acceptance criteria |
| qa_fixer.md | Fixes QA-reported issues |
| spec_gatherer.md | Collects user requirements |
| spec_researcher.md | Validates external integrations |
| spec_writer.md | Creates spec.md document |
| spec_critic.md | Self-critique using ultrathink |
| complexity_assessor.md | AI-based complexity assessment |

### Spec Directory Structure

Each spec in `auto-build/specs/XXX-name/` contains:
- `spec.md` - Feature specification
- `requirements.json` - Structured user requirements
- `context.json` - Discovered codebase context
- `implementation_plan.json` - Chunk-based plan with status tracking
- `qa_report.md` - QA validation results
- `QA_FIX_REQUEST.md` - Issues to fix (when rejected)

### Security Model

Three-layer defense:
1. **OS Sandbox** - Bash command isolation
2. **Filesystem Permissions** - Operations restricted to project directory
3. **Command Allowlist** - Dynamic allowlist from project analysis (security.py + project_analyzer.py)

Security profile cached in `.auto-build-security.json`.

## Development Mode

Use `--dev` flag to work in `dev/auto-build/specs/` (gitignored) when developing the framework itself:
```bash
python auto-build/spec_runner.py --dev --task "Test feature"
python auto-build/run.py --dev --spec 001
```
