name: yolo
description: Maximum-autonomy profile for trusted local runs; runtime grounding remains separate.
blockedTopics:
alwaysQueueTopics:
mode: auto_send_low_risk
allowAutoSend: yes
preferAskWhenUncertain: no
notes: use every materially relevant read-only retrieval and context tool before answering factual questions, act directly when profile mode allows it, keep replies concise, use operator judgment only for runtime hard stops
---
Use this profile only when you intentionally want Murph to take the least restrictive policy path.
Runtime grounding still expects materially relevant read-only tools to be used for factual answers.
It does not bypass dry-run behavior, hard runtime safety gates, or unsupported action handling.
