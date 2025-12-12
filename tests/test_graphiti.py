"""Tests for Graphiti memory integration."""
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add auto-claude to path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "auto-claude"))

from graphiti_config import is_graphiti_enabled, get_graphiti_status, GraphitiConfig


class TestIsGraphitiEnabled:
    """Tests for is_graphiti_enabled function."""

    def test_returns_false_when_not_set(self):
        """Returns False when GRAPHITI_ENABLED is not set."""
        with patch.dict(os.environ, {}, clear=True):
            assert is_graphiti_enabled() is False

    def test_returns_false_when_disabled(self):
        """Returns False when GRAPHITI_ENABLED is false."""
        with patch.dict(os.environ, {"GRAPHITI_ENABLED": "false"}, clear=True):
            assert is_graphiti_enabled() is False

    def test_returns_false_without_openai_key(self):
        """Returns False when enabled but OPENAI_API_KEY not set."""
        with patch.dict(os.environ, {"GRAPHITI_ENABLED": "true"}, clear=True):
            assert is_graphiti_enabled() is False

    def test_returns_true_when_configured(self):
        """Returns True when properly configured."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "OPENAI_API_KEY": "sk-test-key"
        }, clear=True):
            assert is_graphiti_enabled() is True


class TestGetGraphitiStatus:
    """Tests for get_graphiti_status function."""

    def test_status_when_disabled(self):
        """Returns correct status when disabled."""
        with patch.dict(os.environ, {}, clear=True):
            status = get_graphiti_status()
            assert status["enabled"] is False
            assert status["available"] is False
            assert "not set" in status["reason"].lower()

    def test_status_when_missing_openai_key(self):
        """Returns correct status when OPENAI_API_KEY missing."""
        with patch.dict(os.environ, {"GRAPHITI_ENABLED": "true"}, clear=True):
            status = get_graphiti_status()
            assert status["enabled"] is True
            assert status["available"] is False
            assert "openai" in status["reason"].lower()


class TestGraphitiConfig:
    """Tests for GraphitiConfig class."""

    def test_from_env_defaults(self):
        """Config uses correct defaults.

        Note: Default port is 6380 (mapped from FalkorDB's internal 6379)
        to avoid conflicts with local Redis instances.
        """
        with patch.dict(os.environ, {}, clear=True):
            config = GraphitiConfig.from_env()
            assert config.enabled is False
            assert config.falkordb_host == "localhost"
            assert config.falkordb_port == 6380  # Maps to internal 6379
            assert config.database == "auto_build_memory"

    def test_from_env_custom_values(self):
        """Config reads custom environment values."""
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "OPENAI_API_KEY": "sk-test",
            "GRAPHITI_FALKORDB_HOST": "db.example.com",
            "GRAPHITI_FALKORDB_PORT": "6380",
            "GRAPHITI_DATABASE": "my_graph"
        }, clear=True):
            config = GraphitiConfig.from_env()
            assert config.enabled is True
            assert config.falkordb_host == "db.example.com"
            assert config.falkordb_port == 6380
            assert config.database == "my_graph"

    def test_is_valid_requires_enabled_and_key(self):
        """is_valid() requires both GRAPHITI_ENABLED and OPENAI_API_KEY."""
        # Neither set
        with patch.dict(os.environ, {}, clear=True):
            config = GraphitiConfig.from_env()
            assert config.is_valid() is False

        # Only enabled
        with patch.dict(os.environ, {"GRAPHITI_ENABLED": "true"}, clear=True):
            config = GraphitiConfig.from_env()
            assert config.is_valid() is False

        # Both set
        with patch.dict(os.environ, {
            "GRAPHITI_ENABLED": "true",
            "OPENAI_API_KEY": "sk-test"
        }, clear=True):
            config = GraphitiConfig.from_env()
            assert config.is_valid() is True
