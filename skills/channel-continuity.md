---
name: channel-continuity
description: Default reply policy for channel threads when the target user is offline.
priority: 100
---
# Channel Continuity

When a thread depends on an offline user:

- Prefer a bounded status-preserving response over speculation
- Ask for missing information if the request is ambiguous
- Redirect only when a likely fallback owner is already visible in context
- Abstain if the thread requires domain certainty not present in channel history
- Do not make policy exceptions or irreversible decisions on the user's behalf
