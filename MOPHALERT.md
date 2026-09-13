---
name: moph-alert-integration
description: A guide for integrating with the MOPH Alert v3.1 API to send notifications, based on the QueueNotify project's implementation.
---

# MOPH ALERT (v3.1) Integration Guide

This document summarizes how to integrate the MOPH Alert v3.1 API in other projects, based on the QueueNotify implementation. It focuses on practical steps, payload formats, and safe handling of credentials.

## Overview
- API version: v3.1 (current production endpoint in this project)
- Authentication: HTTP headers using client-key and secret-key
- Message types: Flex (default) and Template mode
- Primary use: Send messages to a user by CID

## Base Endpoint
- https://morpromt2c.moph.go.th/alert/v3.1/messages

## Authentication
Send credentials in request headers:
- Content-Type: application/json
- client-key: <your_client_key>
- secret-key: <your_secret_key>

Never log or store plaintext secrets. Encrypt at rest if persisted.

## Core Payload Pattern (v3)
For v3.1, messages are sent with a CID array and a list of messages.

Example (single Flex message):

```json
{
  "cid": ["1234567890123"],
  "messages": [
    {
      "type": "flex",
      "altText": "Example message",
      "contents": {
        "type": "bubble",
        "body": {
          "type": "box",
          "layout": "vertical",
          "contents": [
            {
              "type": "text",
              "text": "Hello from MOPH Alert",
              "wrap": true
            }
          ]
        }
      }
    }
  ],
  "message_title": "Example",
  "message_html": "<div><strong>Example</strong></div>",
  "message_text": "Example",
  "message_type": "HPT"
}
```

## Message Modes
QueueNotify uses a mode flag in settings to select behavior:
- default: send a welcome message, then the main message
- template: use a predefined template payload

Both modes still call the same v3.1 endpoint; the difference is the payload content and sequence.

## Practical Flow (Recommended)
1) Validate CID (must be 13 digits)
2) Build the payload (Flex message)
3) POST to the v3.1 endpoint
4) Check HTTP status and response body
5) Persist status in your app (success/failed + response text)

## Example Python Snippet (requests)

```python
import requests

base_url = "https://morpromt2c.moph.go.th/alert/v3.1/messages"
headers = {
    "Content-Type": "application/json",
    "client-key": "YOUR_CLIENT_KEY",
    "secret-key": "YOUR_SECRET_KEY",
}

payload = {
    "cid": ["1234567890123"],
    "messages": [
        {
            "type": "flex",
            "altText": "Example",
            "contents": {
                "type": "bubble",
                "body": {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        {
                            "type": "text",
                            "text": "Hello from MOPH Alert",
                            "wrap": True,
                        }
                    ],
                },
            },
        }
    ],
    "message_title": "Example",
    "message_html": "<div><strong>Example</strong></div>",
    "message_text": "Example",
    "message_type": "HPT",
}

response = requests.post(base_url, headers=headers, json=payload, timeout=60)
print(response.status_code, response.text)
```

## Retry and Timeout Guidance
QueueNotify uses:
- timeout: 60 seconds
- max_retries: 3
- retry_delay: 5 seconds

Recommended approach:
- Retry on timeout and connection errors
- Log each retry attempt with reason and attempt count
- Do not retry on 4xx unless API documentation explicitly says so

## Common Validation Rules
- CID must be present and exactly 13 digits
- Do not send empty message content
- Use safe fallbacks for optional fields (hospital name, logo)

## Response Handling
- Treat HTTP 200 as success
- Store the response JSON or text for audit/debug
- Mask any sensitive fields before logging

## Integration Checklist
- [ ] Store credentials securely (do not log)
- [ ] Validate CID before sending
- [ ] Apply retries only for transient errors
- [ ] Record success/failure per message
- [ ] Use v3.1 endpoint and payload structure

## Notes
- Payload fields such as message_title, message_html, and message_text are required in template mode in this project.
- If you introduce new message templates, validate the JSON against MOPH Alert requirements.
