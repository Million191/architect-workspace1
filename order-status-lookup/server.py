"""MCP server exposing order-status lookups for the Order Support Assistant."""

from typing import Annotated

from mcp.server.mcpserver import MCPServer
from pydantic import Field

mcp = MCPServer("order-status-lookup")

# Small in-memory sample of order data (stands in for a real orders database).
ORDERS = [
    {"order_id": "ORD-48213", "customer": "Alice Chen", "email": "alice.chen@example.com",
     "status": "Shipped", "carrier": "UPS", "expected_delivery": "2026-08-27"},
    {"order_id": "ORD-90021", "customer": "Marcus Webb", "email": "marcus.webb@example.com",
     "status": "Processing", "carrier": None, "expected_delivery": "2026-08-30"},
    {"order_id": "ORD-11440", "customer": "Priya Nair", "email": "priya.nair@example.com",
     "status": "Delivered", "carrier": "FedEx", "expected_delivery": "2026-08-20"},
    {"order_id": "ORD-77302", "customer": "Alice Chen", "email": "alice.chen@example.com",
     "status": "Delayed", "carrier": "USPS", "expected_delivery": "2026-09-02"},
    {"order_id": "ORD-56218", "customer": "Diego Fuentes", "email": "diego.fuentes@example.com",
     "status": "Shipped", "carrier": "UPS", "expected_delivery": "2026-08-28"},
]


@mcp.tool()
def search_orders(
    query: Annotated[
        str,
        Field(min_length=1, max_length=100, description="Order ID, customer name, or email to search for."),
    ],
    limit: Annotated[
        int,
        Field(ge=1, le=20, description="Maximum number of matching orders to return."),
    ] = 5,
) -> list[dict]:
    """
    Call this whenever a customer asks about the status, tracking, or delivery
    of one or more of their orders, or asks you to find an order by order ID,
    name, or email. This is the only way to see live order data — never guess
    or invent order details.

    Returns a list of matching order records (order_id, customer, email,
    status, carrier, expected_delivery), most relevant first, capped at limit.
    """
    q = query.strip().lower()
    matches = [
        order
        for order in ORDERS
        if q in order["order_id"].lower()
        or q in order["customer"].lower()
        or q in order["email"].lower()
    ]
    return matches[:limit]


if __name__ == "__main__":
    mcp.run(transport="stdio")
