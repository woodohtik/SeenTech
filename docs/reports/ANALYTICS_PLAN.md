# Event Tracking & SaaS Analytics Plan

This document outlines the architecture and implementation strategy for integrating the Tailoring Cloud POS with external analytics tools (Mixpanel, Zoho Analytics) using a middleware-based approach.

## 1. Data Standardization & Routing (Middleware Layer)

We implement a centralized `AnalyticsService` that acts as a middleware/CDP layer. This abstraction ensures:
- **Single Point of Entry**: All events (frontend and simulated backend) pass through this service.
- **Multi-Destination Support**: Events can be routed to Mixpanel, Zoho, or any other tool without modifying the core application logic.
- **Standardized Schema**: Enforces consistent naming conventions and property structures.

## 2. Super Properties & Identity Resolution

Every event is enriched with "Super Properties" to ensure deep analysis capabilities:

### Tenant Isolation (Super Properties)
- `tenant_id`: Unique ID of the tailor shop.
- `tenant_name`: Name of the shop.
- `plan_type`: Current subscription tier (e.g., Basic, Pro, Enterprise).
- `category`: Business category (e.g., Men's Tailoring, Women's Tailoring).

### User Identity (User Traits)
- `user_id`: Unique ID of the staff member.
- `user_role`: Role of the staff member (Owner, Cashier, Tailor).
- `user_email`: Email address for cross-channel communication.

## 3. Core Events Lifecycle

| Event Name | Trigger Point | Key Properties |
|------------|---------------|----------------|
| `Tenant_Onboarded_Successfully` | Onboarding completion | `customer_id`, `shop_name`, `category` |
| `Order_Created` | New order submission | `order_id`, `customer_id`, `total_amount` |
| `Measurements_Added` | Measurement entry | `order_id`, `garment_type`, `customization_details` |
| `Payment_Completed` | Payment processing | `amount_paid`, `remaining_amount`, `payment_method` |
| `Order_Delivered` | Order status update | `order_id`, `delivery_time`, `total_amount` |
| `Low_Stock_Alert` | Inventory threshold hit | `item_name`, `current_quantity`, `min_threshold` |

## 4. Backend Sync & SaaS Metrics

To ensure 100% accuracy for financial data and bypass ad-blockers, subscription-related events are handled via a simulated backend layer:
- `Subscription_Upgraded`
- `Subscription_Renewed`
- `Subscription_Churned`
- `MRR_Update`

## 5. Implementation Strategy

1. **Service Layer**: Create `src/services/analyticsService.ts`.
2. **Context Enrichment**: Use a React Hook/Provider to automatically inject tenant context into every event.
3. **Event Injection**: Manually trigger events at critical business logic points.
4. **Onboarding Guard**: Enforce `Customer ID` as the primary key for all initial tracking.
