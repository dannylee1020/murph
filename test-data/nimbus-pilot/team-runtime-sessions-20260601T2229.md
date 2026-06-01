# Team runtime session scoping test fixture

This draft PR represents the implementation side of the Nimbus Support pilot.

Implementation notes:
- Replace subscriber-owned routing assumptions with channel/team-scoped session ownership.
- Preserve thread continuity so follow-up stakeholder questions stay attached to the same team work item.
- Remove per-user dashboard entry points from the team runtime surface.
- Keep personal-only connectors out of team retrieval defaults.

Review focus:
- Verify Slack and Discord adapters no longer require user subscriptions for team-mode replies.
- Confirm admin dashboard queries group sessions by workspace/channel/thread.
- Confirm personal runtime still allows private sources such as Obsidian and Granola.

Linear: MUR-10
Notion: https://www.notion.so/TEST-DATA-Nimbus-pilot-Friday-stakeholder-update-372da49acbb281219594e2d558e47139
