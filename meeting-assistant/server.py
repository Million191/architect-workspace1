"""MCP server for the Meeting Assistance project."""

import json
from pathlib import Path
from typing import Annotated, Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ResourceNotFoundError
from pydantic import Field

mcp = MCPServer("meeting-assistant")

ACTION_ITEMS_PATH = Path(__file__).parent / "data" / "action_items.json"
MEETING_SUMMARIES_PATH = Path(__file__).parent / "data" / "meeting_summaries.json"


@mcp.tool()
def search_action_items(
    owner: Annotated[
        str | None,
        Field(min_length=1, max_length=100, description="Full or partial name of the person the action item is assigned to (case-insensitive). Omit to match any owner."),
    ] = None,
    status: Annotated[
        Literal["open", "in_progress", "done"] | None,
        Field(description="Filter to only action items in this status. Omit to match any status."),
    ] = None,
    limit: Annotated[
        int,
        Field(ge=1, le=20, description="Maximum number of matching action items to return."),
    ] = 5,
) -> dict:
    """
    Call this whenever someone asks what they (or a named teammate) still owe from a past
    meeting, wants to know what's open, overdue, or in progress, or needs a status check on
    action items before or during a meeting — for example "what does Priya still owe me",
    "show me open action items", or "what's outstanding from last week's sync". This is the
    only way to see real action item data — never guess or invent an action item, owner, due
    date, or status.

    Returns a dict with `count` and `items`; each item has `task`, `owner`, `dueDate`,
    `priority`, `status`, `meetingTitle`, `meetingDate`, and `flaggedForReview` (true when the
    item is missing a due date, priority, or other expected field). If nothing matches, returns
    `count: 0` and an empty `items` list with a `message` explaining why.
    """
    with ACTION_ITEMS_PATH.open("r", encoding="utf-8") as f:
        all_items = json.load(f)

    matches = all_items
    if owner is not None:
        needle = owner.strip().lower()
        matches = [item for item in matches if needle in (item.get("owner") or "").lower()]
    if status is not None:
        matches = [item for item in matches if item.get("status") == status]

    matches = matches[:limit]

    if not matches:
        return {
            "count": 0,
            "items": [],
            "message": "No action items matched that owner/status filter.",
        }

    return {
        "count": len(matches),
        "items": [
            {
                "task": item["task"],
                "owner": item.get("owner"),
                "dueDate": item.get("dueDate"),
                "priority": item.get("priority"),
                "status": item.get("status"),
                "meetingTitle": item.get("meetingTitle"),
                "meetingDate": item.get("meetingDate"),
                "flaggedForReview": item.get("flaggedForReview", False),
            }
            for item in matches
        ],
    }


@mcp.tool()
def get_meeting_summary(
    meeting_id: Annotated[
        str,
        Field(min_length=1, max_length=100, description="The meeting's id, e.g. \"mtg-2026-08-19-acme-onboarding\" — the same id used to group its action items."),
    ],
) -> dict:
    """
    Call this whenever someone asks what a specific meeting was about, wants its objective,
    attendees, format, or date/time, or wants the discussion topics and their summaries — for
    example "what was the Acme onboarding call about", "who attended the Q3 roadmap sync", or
    "summarize last week's standup". This is the only way to see real meeting summary data —
    never invent a meeting's objective, attendees, or topics.

    Returns a dict with `found: true`, `title`, `date`, `time`, `format` ("Virtual" or
    "In-Person"), `platformOrLocation`, `attendees`, `objective`, `missingFields` (fields that
    were never supplied — not guessed), and `topics` (each with `topic`, `summary`,
    `flaggedForReview`). If no meeting matches that id, returns `found: false` with a `message`.
    """
    with MEETING_SUMMARIES_PATH.open("r", encoding="utf-8") as f:
        all_summaries = json.load(f)

    match = next((s for s in all_summaries if s.get("meetingId") == meeting_id), None)

    if match is None:
        return {
            "found": False,
            "message": f"No meeting found with id '{meeting_id}'.",
        }

    return {
        "found": True,
        "title": match.get("title"),
        "date": match.get("date"),
        "time": match.get("time"),
        "format": match.get("format"),
        "platformOrLocation": match.get("platformOrLocation"),
        "attendees": match.get("attendees", []),
        "objective": match.get("objective"),
        "missingFields": match.get("missingFields", []),
        "topics": match.get("topics", []),
    }


@mcp.resource("meetings://catalog", mime_type="application/json")
def list_meetings_catalog() -> str:
    """A lightweight index of every known meeting (id, title, date, format) — read the
    per-meeting resource (meetings://{meeting_id}) for full details on one of them."""
    with MEETING_SUMMARIES_PATH.open("r", encoding="utf-8") as f:
        all_summaries = json.load(f)

    catalog = [
        {
            "meetingId": s.get("meetingId"),
            "title": s.get("title"),
            "date": s.get("date"),
            "format": s.get("format"),
        }
        for s in all_summaries
    ]
    return json.dumps(catalog, indent=2)


@mcp.resource("meetings://{meeting_id}", mime_type="application/json")
def get_meeting_resource(meeting_id: str) -> str:
    """The full summary and discussion topics for one meeting, addressed by its id
    (see meetings://catalog for the list of valid ids)."""
    with MEETING_SUMMARIES_PATH.open("r", encoding="utf-8") as f:
        all_summaries = json.load(f)

    match = next((s for s in all_summaries if s.get("meetingId") == meeting_id), None)

    if match is None:
        raise ResourceNotFoundError(f"No meeting found with id '{meeting_id}'.")

    return json.dumps(match, indent=2)


if __name__ == "__main__":
    mcp.run(transport="stdio")
