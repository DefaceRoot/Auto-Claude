#!/usr/bin/env python3
"""
Quick Mode Runner
=================

A streamlined execution mode that uses Claude Code's native planning and coding
without the full Auto Claude framework overhead.

Quick Mode runs two simple phases:
1. Planning Phase - Claude analyzes the task and creates an implementation plan
2. Implementation Phase - A fresh Claude instance implements the plan

No specs, no subtasks, no QA loops - just plan and code.

Usage:
    python auto-claude/run_quick.py --spec 001-feature --project-dir /path/to/project
    python auto-claude/run_quick.py --task "Add a logout button" --project-dir /path/to/project
"""

import sys

# Python version check
if sys.version_info < (3, 10):
    sys.exit(
        f"Error: Quick Mode requires Python 3.10 or higher.\n"
        f"You are running Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    )

import argparse
import asyncio
import io
import os
from pathlib import Path

# Configure safe encoding on Windows
if sys.platform == "win32":
    for _stream_name in ("stdout", "stderr"):
        _stream = getattr(sys, _stream_name)
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
                continue
            except (AttributeError, io.UnsupportedOperation, OSError):
                pass
        try:
            if hasattr(_stream, "buffer"):
                _new_stream = io.TextIOWrapper(
                    _stream.buffer,
                    encoding="utf-8",
                    errors="replace",
                    line_buffering=True,
                )
                setattr(sys, _stream_name, _new_stream)
        except (AttributeError, io.UnsupportedOperation, OSError):
            pass

# Add parent directory to path for imports
_PARENT_DIR = Path(__file__).parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from core.client import create_client
from phase_config import get_phase_model, get_phase_thinking_budget
from ui import (
    BuildState,
    Icons,
    StatusManager,
    bold,
    box,
    highlight,
    icon,
    muted,
    print_status,
    success,
    warning,
)


DEFAULT_MODEL = "claude-sonnet-4-20250514"


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Quick Mode - Fast planning and coding without Auto Claude overhead",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run with a spec directory
  python auto-claude/run_quick.py --spec 001-feature --project-dir /path/to/project

  # Run with inline task description
  python auto-claude/run_quick.py --task "Add logout button" --project-dir /path/to/project

Quick Mode Philosophy:
  - Two phases: Plan → Implement
  - No spec creation pipeline
  - No QA validation loop
  - Fresh Claude context per phase
        """,
    )

    parser.add_argument(
        "--spec",
        type=str,
        help="Spec ID (e.g., '001' or '001-feature-name')",
    )

    parser.add_argument(
        "--task",
        type=str,
        help="Task description (used if no spec provided)",
    )

    parser.add_argument(
        "--project-dir",
        type=Path,
        required=True,
        help="Project directory (required)",
    )

    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help=f"Claude model to use (default: {DEFAULT_MODEL})",
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose output",
    )

    parser.add_argument(
        "--base-branch",
        type=str,
        default=None,
        help="Base branch for worktree creation",
    )

    return parser.parse_args()


def get_spec_dir(project_dir: Path, spec_id: str) -> Path:
    """Get the spec directory path."""
    # Check both .auto-claude/specs and auto-claude/specs locations
    for specs_base in [
        project_dir / ".auto-claude" / "specs",
        project_dir / "auto-claude" / "specs",
    ]:
        if specs_base.exists():
            # Find spec by ID prefix
            for spec_dir in specs_base.iterdir():
                if spec_dir.is_dir() and (
                    spec_dir.name == spec_id or spec_dir.name.startswith(f"{spec_id}-")
                ):
                    return spec_dir

    # If not found, create in .auto-claude/specs
    specs_base = project_dir / ".auto-claude" / "specs"
    specs_base.mkdir(parents=True, exist_ok=True)
    spec_dir = specs_base / spec_id
    spec_dir.mkdir(exist_ok=True)
    return spec_dir


def load_prompt_template(prompt_name: str) -> str:
    """Load a prompt template from the prompts directory."""
    prompts_dir = Path(__file__).parent / "prompts"
    prompt_file = prompts_dir / f"{prompt_name}.md"

    if prompt_file.exists():
        return prompt_file.read_text()
    else:
        raise FileNotFoundError(f"Prompt template not found: {prompt_file}")


def generate_planning_prompt(spec_dir: Path, task_description: str) -> str:
    """Generate the planning phase prompt."""
    template = load_prompt_template("quick_planner")

    # Build the full prompt with task and context
    prompt = f"""## ENVIRONMENT

Working directory: {spec_dir.parent.parent.parent}
Spec directory: {spec_dir}

---

{template}

---

## TASK DESCRIPTION

{task_description}
"""
    return prompt


def generate_implementation_prompt(spec_dir: Path) -> str:
    """Generate the implementation phase prompt."""
    template = load_prompt_template("quick_coder")

    # Read the plan created by the planning phase
    plan_file = spec_dir / "quick_plan.md"
    plan_content = ""
    if plan_file.exists():
        plan_content = plan_file.read_text()

    # Build the full prompt with plan context
    prompt = f"""## ENVIRONMENT

Working directory: {spec_dir.parent.parent.parent}
Spec directory: {spec_dir}

---

{template}

---

## IMPLEMENTATION PLAN

The planning phase created this plan for you to execute:

```markdown
{plan_content}
```

Execute this plan now.
"""
    return prompt


async def run_planning_phase(
    project_dir: Path,
    spec_dir: Path,
    model: str,
    task_description: str,
    verbose: bool = False,
) -> bool:
    """
    Run the planning phase.

    Claude analyzes the task and creates an implementation plan.
    """
    from agents.session import run_agent_session
    from task_logger import LogPhase

    print()
    content = [
        bold(f"{icon(Icons.GEAR)} QUICK MODE - PLANNING PHASE"),
        "",
        f"Task: {highlight(task_description[:100])}{'...' if len(task_description) > 100 else ''}",
        muted("Claude will analyze the task and create an implementation plan."),
    ]
    print(box(content, width=70, style="heavy"))
    print()

    # Get model and thinking budget for planning phase
    planning_model = get_phase_model(spec_dir, "planning", model, resolve=False)
    planning_thinking = get_phase_thinking_budget(spec_dir, "planning")

    print_status(f"Model: {planning_model}", "info")
    if planning_thinking:
        print_status(f"Thinking budget: {planning_thinking} tokens", "info")
    print()

    # Create client for planning
    client = create_client(
        project_dir,
        spec_dir,
        planning_model,
        agent_type="planner",
        max_thinking_tokens=planning_thinking,
    )

    # Generate planning prompt
    prompt = generate_planning_prompt(spec_dir, task_description)

    print_status("Starting planning session...", "progress")
    print()

    try:
        async with client:
            status, response = await run_agent_session(
                client, prompt, spec_dir, verbose, phase=LogPhase.PLANNING
            )

        if status == "error":
            print()
            print_status("Planning phase failed", "error")
            return False

        # Verify plan was created
        plan_file = spec_dir / "quick_plan.md"
        if not plan_file.exists():
            print()
            print_status("Warning: quick_plan.md was not created", "warning")
            print(muted("The planning agent should have created this file."))
            return False

        print()
        print_status("Planning phase complete", "success")
        return True

    except Exception as e:
        print()
        print_status(f"Planning error: {e}", "error")
        return False


async def run_implementation_phase(
    project_dir: Path,
    spec_dir: Path,
    model: str,
    verbose: bool = False,
) -> bool:
    """
    Run the implementation phase.

    A fresh Claude instance reads the plan and implements it.
    """
    from agents.session import run_agent_session
    from task_logger import LogPhase

    print()
    content = [
        bold(f"{icon(Icons.CODE)} QUICK MODE - IMPLEMENTATION PHASE"),
        "",
        muted("Claude will now implement the plan."),
    ]
    print(box(content, width=70, style="heavy"))
    print()

    # Get model and thinking budget for coding phase
    coding_model = get_phase_model(spec_dir, "coding", model, resolve=False)
    coding_thinking = get_phase_thinking_budget(spec_dir, "coding")

    print_status(f"Model: {coding_model}", "info")
    if coding_thinking:
        print_status(f"Thinking budget: {coding_thinking} tokens", "info")
    print()

    # Create fresh client for implementation (new context)
    client = create_client(
        project_dir,
        spec_dir,
        coding_model,
        agent_type="coder",
        max_thinking_tokens=coding_thinking,
    )

    # Generate implementation prompt with plan
    prompt = generate_implementation_prompt(spec_dir)

    print_status("Starting implementation session...", "progress")
    print()

    try:
        async with client:
            status, response = await run_agent_session(
                client, prompt, spec_dir, verbose, phase=LogPhase.CODING
            )

        if status == "error":
            print()
            print_status("Implementation phase failed", "error")
            return False

        print()
        print_status("Implementation phase complete", "success")
        return True

    except Exception as e:
        print()
        print_status(f"Implementation error: {e}", "error")
        return False


async def run_quick_mode(
    project_dir: Path,
    spec_dir: Path,
    model: str,
    task_description: str,
    verbose: bool = False,
) -> bool:
    """
    Run Quick Mode with two phases: Planning and Implementation.
    """
    # Initialize status manager
    status_manager = StatusManager(project_dir)
    status_manager.set_active(spec_dir.name, BuildState.PLANNING)

    print()
    print("=" * 70)
    print("  QUICK MODE")
    print("=" * 70)
    print()
    print(f"Project: {project_dir}")
    print(f"Spec: {spec_dir.name}")
    print(f"Model: {model}")
    print()

    # Phase 1: Planning
    status_manager.update(state=BuildState.PLANNING)
    planning_success = await run_planning_phase(
        project_dir, spec_dir, model, task_description, verbose
    )

    if not planning_success:
        status_manager.update(state=BuildState.ERROR)
        print()
        print_status("Quick Mode failed in planning phase", "error")
        return False

    # Phase 2: Implementation
    status_manager.update(state=BuildState.BUILDING)
    implementation_success = await run_implementation_phase(
        project_dir, spec_dir, model, verbose
    )

    if not implementation_success:
        status_manager.update(state=BuildState.ERROR)
        print()
        print_status("Quick Mode failed in implementation phase", "error")
        return False

    # Success!
    status_manager.update(state=BuildState.COMPLETE)
    print()
    print("=" * 70)
    print("  ✅ QUICK MODE COMPLETE")
    print("=" * 70)
    print()
    print(success("Task completed successfully!"))
    print()

    return True


def get_task_description(spec_dir: Path, inline_task: str | None) -> str:
    """Get task description from spec.md or inline task argument."""
    # Prefer inline task if provided
    if inline_task:
        return inline_task

    # Try to read from spec.md
    spec_file = spec_dir / "spec.md"
    if spec_file.exists():
        content = spec_file.read_text()
        # Extract task from minimal spec format
        if "## Task" in content:
            # Find the Task section
            lines = content.split("\n")
            task_lines = []
            in_task = False
            for line in lines:
                if line.startswith("## Task"):
                    in_task = True
                    continue
                elif line.startswith("##") and in_task:
                    break
                elif in_task:
                    task_lines.append(line)
            task = "\n".join(task_lines).strip()
            if task:
                return task
        # Fall back to first paragraph after title
        return content[:500]

    raise ValueError("No task description provided. Use --task or create spec.md")


def main():
    """Main entry point for Quick Mode."""
    from core.auth import require_auth_token

    args = parse_args()

    # Validate arguments
    if not args.spec and not args.task:
        print("Error: Either --spec or --task is required")
        sys.exit(1)

    # Resolve project directory
    project_dir = args.project_dir.resolve()
    if not project_dir.exists():
        print(f"Error: Project directory does not exist: {project_dir}")
        sys.exit(1)

    # Set working directory
    os.chdir(project_dir)

    # Get or create spec directory
    if args.spec:
        spec_dir = get_spec_dir(project_dir, args.spec)
    else:
        # Create a temporary spec directory for inline tasks
        import time
        timestamp = int(time.time())
        spec_dir = get_spec_dir(project_dir, f"quick-{timestamp}")

    # Get task description
    try:
        task_description = get_task_description(spec_dir, args.task)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)

    # Validate environment
    try:
        require_auth_token()
    except ValueError as e:
        print(f"Error: {e}")
        print("Run 'claude setup-token' to set up authentication.")
        sys.exit(1)

    # Resolve model
    model = args.model or os.environ.get("AUTO_BUILD_MODEL", DEFAULT_MODEL)

    # Print banner
    print()
    print(bold("🚀 Quick Mode"))
    print(muted("Fast planning and coding without Auto Claude overhead"))
    print()

    # Run quick mode
    try:
        success = asyncio.run(
            run_quick_mode(
                project_dir=project_dir,
                spec_dir=spec_dir,
                model=model,
                task_description=task_description,
                verbose=args.verbose,
            )
        )
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print()
        print(warning("Quick Mode interrupted by user"))
        sys.exit(130)
    except Exception as e:
        print()
        print_status(f"Fatal error: {e}", "error")
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
