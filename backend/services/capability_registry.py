from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, List


@dataclass(frozen=True)
class Capability:
    id: str
    label: str
    status: str
    permission: str
    confirmation: str


_CAPABILITIES: Dict[str, Capability] = {
    "screen_context": Capability("screen_context", "Screen and task context", "available", "screen.read", "never"),
    "lead_research": Capability("lead_research", "Lead research and workflow execution", "available", "leads.read", "external_write"),
    "pc_launch": Capability("pc_launch", "PC and app launching", "available", "pc.launch", "never"),
    "memory": Capability("memory", "Preference and memory recall", "available", "memory.read", "never"),
    "calendar": Capability("calendar", "Calendar and reminders", "planned", "calendar.events", "external_write"),
    "camera_understanding": Capability("camera_understanding", "Camera understanding", "planned", "camera.read", "explicit"),
    "smart_devices": Capability("smart_devices", "Smart-device control", "planned", "iot.control", "explicit"),
    "device_handoff": Capability("device_handoff", "Multi-device session handoff", "planned", "session.handoff", "explicit"),
    "background_tasks": Capability("background_tasks", "Long-running background tasks", "available", "tasks.run", "external_write"),
}


def list_capabilities() -> List[dict]:
    return [asdict(item) for item in _CAPABILITIES.values()]


def get_capability(capability_id: str) -> Capability | None:
    return _CAPABILITIES.get(capability_id)
