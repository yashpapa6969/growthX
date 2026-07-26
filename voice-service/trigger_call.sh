#!/usr/bin/env bash
# Instant outbound call from the Sarvam agent ("Pooja - Khata Collection", v2).
#
# Usage:
#   ./trigger_call.sh +91XXXXXXXXXX '<agent_variables JSON>'
#
# Example:
#   ./trigger_call.sh +919876543210 '{
#     "userName": "Rahul",
#     "order_items_summary": "2 kilo aata, 1 packet Maggi",
#     "due_amount": "1850", "order_date": "12 July 2026", "due_date": "19 July 2026",
#     "promise_verbatim": "Monday tak pakka", "promise_date": "21 July 2026",
#     "balance_amount": "1850", "broken_promises_count": "1"
#   }'
#
# Omit the JSON arg to call with the agent's saved variable defaults.
# Unlisted variables fall back to their defaults too, so pass only what changes.
# Reads SARVAM_SAMVAAD_API_KEY from voice-service/.env — the Voice Agents
# product key (sk_samvaad_...), NOT the regular sk_ subscription key.

set -euo pipefail

TO_NUMBER="${1:?usage: ./trigger_call.sh +91XXXXXXXXXX ['<agent_variables JSON>']}"
AGENT_VARIABLES="${2:-{\}}"

cd "$(dirname "$0")"
SARVAM_SAMVAAD_API_KEY="${SARVAM_SAMVAAD_API_KEY:-$(grep '^SARVAM_SAMVAAD_API_KEY=' .env | cut -d= -f2)}"

curl -sS -X POST "https://apps.sarvam.ai/api/outbounds/v1/orgs/019f9a6f-7b69-7ca2-a1de-21171d3b0c40/workspaces/019f9a6f-7b6e-76df-ae9e-0745081126f2/outbounds" \
  --header 'Content-Type: application/json' \
  --header "X-API-Key: ${SARVAM_SAMVAAD_API_KEY}" \
  --data @- <<JSON
{
  "app_config": {
    "app_id": "Conversatio-212c836e-fd87",
    "app_version": 2,
    "app_type": "agent",
    "connection_config": {
      "connection_id": "Twilio-yash-583da5f6-62e1",
      "agent_phone_number": "+17174008723"
    },
    "agent_variables": ${AGENT_VARIABLES}
  },
  "user_config": { "user_phone_number": "${TO_NUMBER}" }
}
JSON
echo

