"""
One complete tool-use round trip for the Order Support Assistant.

One question -> one tool -> one round trip. Data source is a hardcoded
dict, standing in for a real orders database. Run: python round_trip.py
"""

import json
import os

from dotenv import load_dotenv
import anthropic

load_dotenv()

MODEL = "claude-opus-5"

# --- hardcoded data source (stands in for a real orders DB) ---
ORDERS_DB = {
    "ORD-48213": {
        "status": "Shipped",
        "carrier": "UPS",
        "tracking_number": "1Z999AA10123456784",
        "expected_delivery": "2026-08-27",
    },
    "ORD-90021": {
        "status": "Processing",
        "carrier": None,
        "tracking_number": None,
        "expected_delivery": "2026-08-30",
    },
}


def get_order_status(order_id: str) -> dict:
    """MY function. This is the real lookup — Claude never runs this code."""
    order = ORDERS_DB.get(order_id)
    if order is None:
        return {"error": f"No order found with ID '{order_id}'."}
    return order


TOOLS = [
    {
        "name": "get_order_status",
        "description": (
            "Look up the current status, carrier, tracking number, and expected "
            "delivery date for a customer's order by order ID. Use this whenever "
            "the customer asks where their order is, mentions an order number, "
            "or asks about shipping or delivery status."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "order_id": {
                    "type": "string",
                    "description": "The order ID, e.g. 'ORD-48213'.",
                }
            },
            "required": ["order_id"],
        },
    }
]

USER_QUESTION = "Hi, can you tell me where my order ORD-48213 is?"


def main() -> None:
    client = anthropic.Anthropic()
    messages = [{"role": "user", "content": USER_QUESTION}]

    # --- (1) the request I sent ---
    print("=" * 70)
    print("(1) REQUEST SENT")
    print("=" * 70)
    request_payload = {
        "model": MODEL,
        "max_tokens": 1024,
        "tools": TOOLS,
        "messages": messages,
    }
    print(json.dumps(request_payload, indent=2))

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        tools=TOOLS,
        messages=messages,
    )

    # --- (2) stop_reason ---
    print("\n" + "=" * 70)
    print("(2) STOP_REASON")
    print("=" * 70)
    print(response.stop_reason)

    if response.stop_reason != "tool_use":
        print("\nModel answered without needing the tool. Final text:")
        print(next(b.text for b in response.content if b.type == "text"))
        return

    tool_use_block = next(b for b in response.content if b.type == "tool_use")

    # --- (3) the tool_use block ---
    print("\n" + "=" * 70)
    print("(3) TOOL_USE BLOCK")
    print("=" * 70)
    print(f"id:    {tool_use_block.id}")
    print(f"name:  {tool_use_block.name}")
    print(f"input: {json.dumps(tool_use_block.input, indent=2)}")

    # --- (4) MY function executes here ---
    print("\n" + "=" * 70)
    print("(4) MY FUNCTION EXECUTES")
    print("=" * 70)
    print(f"Calling get_order_status(order_id={tool_use_block.input['order_id']!r}) ...")
    result = get_order_status(**tool_use_block.input)
    print(f"Result: {json.dumps(result)}")

    # --- (5) the tool_result I send back ---
    messages.append({"role": "assistant", "content": response.content})
    tool_result_message = {
        "role": "user",
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": tool_use_block.id,  # ties this result to the request above
                "content": json.dumps(result),
            }
        ],
    }
    messages.append(tool_result_message)

    print("\n" + "=" * 70)
    print("(5) TOOL_RESULT SENT BACK")
    print("=" * 70)
    print(json.dumps(tool_result_message, indent=2))

    followup = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        tools=TOOLS,
        messages=messages,
    )

    # --- (6) final answer ---
    print("\n" + "=" * 70)
    print("(6) FINAL ANSWER")
    print("=" * 70)
    final_text = next(b.text for b in followup.content if b.type == "text")
    print(final_text)


if __name__ == "__main__":
    main()
