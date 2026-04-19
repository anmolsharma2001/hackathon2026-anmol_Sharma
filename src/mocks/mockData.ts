import { Customer, Order, Product } from "../types";

export const MOCK_CUSTOMERS: Record<string, Customer> = {
  "alice.turner@email.com": { email: "alice.turner@email.com", name: "Alice Turner", tier: "vip", total_orders: 47, account_created: "2019-03-12", is_flagged: false },
  "bob.mendes@email.com": { email: "bob.mendes@email.com", name: "Bob Mendes", tier: "standard", total_orders: 3, account_created: "2023-10-05", is_flagged: false },
  "carol.nguyen@email.com": { email: "carol.nguyen@email.com", name: "Carol Nguyen", tier: "premium", total_orders: 22, account_created: "2021-06-18", is_flagged: false },
  "david.park@email.com": { email: "david.park@email.com", name: "David Park", tier: "standard", total_orders: 9, account_created: "2022-01-30", is_flagged: true },
  "emma.collins@email.com": { email: "emma.collins@email.com", name: "Emma Collins", tier: "vip", total_orders: 91, account_created: "2018-11-02", is_flagged: false },
  "frank.osei@email.com": { email: "frank.osei@email.com", name: "Frank Osei", tier: "new", total_orders: 1, account_created: "2024-01-14", is_flagged: false },
  "grace.patel@email.com": { email: "grace.patel@email.com", name: "Grace Patel", tier: "premium", total_orders: 35, account_created: "2020-08-22", is_flagged: false },
  "henry.marsh@email.com": { email: "henry.marsh@email.com", name: "Henry Marsh", tier: "standard", total_orders: 14, account_created: "2022-05-19", is_flagged: false },
  "irene.castillo@email.com": { email: "irene.castillo@email.com", name: "Irene Castillo", tier: "premium", total_orders: 28, account_created: "2021-02-10", is_flagged: false },
  "james.wu@email.com": { email: "james.wu@email.com", name: "James Wu", tier: "standard", total_orders: 6, account_created: "2023-03-28", is_flagged: false },
};

export const MOCK_ORDERS: Record<string, Order> = {
  "ORD-1001": { order_id: "ORD-1001", customer_email: "alice.turner@email.com", product_id: "P001", status: "delivered", amount: 129.99, currency: "USD", created_at: "2024-02-10", return_deadline: "2024-03-15", tracking_number: "TRK-11001", notes: "Delivered on time. No issues logged at delivery." },
  "ORD-1002": { order_id: "ORD-1002", customer_email: "bob.mendes@email.com", product_id: "P006", status: "delivered", amount: 249.99, currency: "USD", created_at: "2024-03-01", return_deadline: "2024-03-19", tracking_number: "TRK-11002", notes: "High-value item. 15-day return window applies." },
  "ORD-1003": { order_id: "ORD-1003", customer_email: "carol.nguyen@email.com", product_id: "P003", status: "delivered", amount: 199.99, currency: "USD", created_at: "2024-01-05", return_deadline: "2024-02-08", tracking_number: "TRK-11003", notes: "Return window has expired. Warranty still active until 2026-01-09." },
  "ORD-1004": { order_id: "ORD-1004", customer_email: "david.park@email.com", product_id: "P002", status: "delivered", amount: 89.99, currency: "USD", created_at: "2024-02-20", return_deadline: "2024-03-25", tracking_number: "TRK-11004", notes: "Customer requested size exchange but no formal return initiated." },
  "ORD-1005": { order_id: "ORD-1005", customer_email: "emma.collins@email.com", product_id: "P008", status: "delivered", amount: 159.98, currency: "USD", created_at: "2023-12-15", return_deadline: "2024-01-18", tracking_number: "TRK-11005", notes: "Return window expired. VIP customer with pre-approved extended return exception on file." },
  "ORD-1006": { order_id: "ORD-1006", customer_email: "frank.osei@email.com", product_id: "P005", status: "delivered", amount: 39.99, currency: "USD", created_at: "2024-03-10", return_deadline: "2024-04-12", tracking_number: "TRK-11006", notes: "First order by this customer." },
  "ORD-1007": { order_id: "ORD-1007", customer_email: "grace.patel@email.com", product_id: "P004", status: "delivered", amount: 49.99, currency: "USD", created_at: "2024-02-01", return_deadline: "2024-04-05", tracking_number: "TRK-11007", notes: "60-day return window applies for this product category." },
  "ORD-1008": { order_id: "ORD-1008", customer_email: "henry.marsh@email.com", product_id: "P007", status: "delivered", amount: 44.99, currency: "USD", created_at: "2024-03-05", return_deadline: "2024-04-07", tracking_number: "TRK-11008", notes: "Item reported as damaged on arrival. No formal claim opened." },
  "ORD-1009": { order_id: "ORD-1009", customer_email: "irene.castillo@email.com", product_id: "P001", status: "delivered", amount: 129.99, currency: "USD", created_at: "2024-02-25", return_deadline: "2024-03-29", tracking_number: "TRK-11009", refund_status: "refunded", notes: "Refund already processed on 2024-03-02. Full amount returned." },
  "ORD-1010": { order_id: "ORD-1010", customer_email: "james.wu@email.com", product_id: "P003", status: "shipped", amount: 199.99, currency: "USD", created_at: "2024-03-12", tracking_number: "TRK-88291", notes: "In transit. Expected delivery 2024-03-16." },
  "ORD-1011": { order_id: "ORD-1011", customer_email: "alice.turner@email.com", product_id: "P006", status: "delivered", amount: 249.99, currency: "USD", created_at: "2024-03-08", return_deadline: "2024-03-26", tracking_number: "TRK-11011", notes: "Customer received wrong colour variant. Correct order was Blue, received Black." },
  "ORD-1012": { order_id: "ORD-1012", customer_email: "carol.nguyen@email.com", product_id: "P002", status: "processing", amount: 89.99, currency: "USD", created_at: "2024-03-14", notes: "Order placed but not yet shipped. Customer can cancel free of charge." },
  "ORD-1013": { order_id: "ORD-1013", customer_email: "grace.patel@email.com", product_id: "P008", status: "delivered", amount: 79.99, currency: "USD", created_at: "2024-01-20", return_deadline: "2024-02-23", tracking_number: "TRK-11013", notes: "Return window expired. Device was registered online on 2024-01-25. Non-returnable per policy." },
  "ORD-1014": { order_id: "ORD-1014", customer_email: "henry.marsh@email.com", product_id: "P006", status: "delivered", amount: 249.99, currency: "USD", created_at: "2024-03-01", return_deadline: "2024-03-19", tracking_number: "TRK-11014", notes: "Within return window. No issues logged." },
  "ORD-1015": { order_id: "ORD-1015", customer_email: "emma.collins@email.com", product_id: "P003", status: "delivered", amount: 199.99, currency: "USD", created_at: "2024-02-18", return_deadline: "2024-03-23", tracking_number: "TRK-11015", notes: "Item arrived with cracked water tank. Customer sent photo evidence." },
};

export const MOCK_PRODUCTS: Record<string, Product> = {
  "P001": { product_id: "P001", name: "SoundMax Pro Headphones", category: "Electronics", price: 129.99, warranty_months: 12, in_stock: true, description: "Wireless noise-cancelling headphones" },
  "P002": { product_id: "P002", name: "AeroRun Running Shoes", category: "Footwear", price: 89.99, warranty_months: 6, in_stock: true, description: "Lightweight performance running shoes" },
  "P003": { product_id: "P003", name: "BrewMaster Coffee Maker", category: "Kitchen", price: 199.99, warranty_months: 24, in_stock: true, description: "12-cup programmable coffee maker with grinder" },
  "P004": { product_id: "P004", name: "ErgoLift Laptop Stand", category: "Office", price: 49.99, warranty_months: 12, in_stock: true, description: "Adjustable aluminium laptop stand" },
  "P005": { product_id: "P005", name: "PowerBank 20000", category: "Electronics", price: 39.99, warranty_months: 12, in_stock: true, description: "20000mAh portable charger" },
  "P006": { product_id: "P006", name: "PulseX Smart Watch", category: "Electronics", price: 249.99, warranty_months: 12, in_stock: true, description: "Fitness smartwatch with GPS and heart rate" },
  "P007": { product_id: "P007", name: "LumiDesk Desk Lamp", category: "Home", price: 44.99, warranty_months: 12, in_stock: true, description: "LED desk lamp with USB charging" },
  "P008": { product_id: "P008", name: "BassWave BT Speaker", category: "Electronics", price: 79.99, warranty_months: 12, in_stock: true, description: "Portable waterproof bluetooth speaker" },
};
