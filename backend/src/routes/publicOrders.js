const express = require("express");
const { z } = require("zod");
const Order = require("../models/Order");
const { makeToken } = require("../utils/tokens");

const router = express.Router();

const CartLine = z.object({
  itemId: z.string().min(1),
  name: z.string().min(1),
  unitPrice: z.number().nonnegative(),
  qty: z.number().int().min(1).max(50),
  notes: z.string().optional().default(""),
  lineTotal: z.number().nonnegative(),
});

const CreateOrderBody = z.object({
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
  }),
  type: z.enum(["Dine-In", "Pickup", "Delivery"]),
  address: z.string().optional().nullable(),
  cart: z.array(CartLine).min(1),
  pricing: z.object({
    subtotal: z.number().nonnegative(),
    deliveryFee: z.number().nonnegative(),
    total: z.number().nonnegative(),
    currency: z.string().optional().default("GHS"),
  }),
});

// Customer places an order
router.post("/", async (req, res) => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const body = parsed.data;
  const isDelivery = body.type === "Delivery";
  const customerToken = isDelivery ? makeToken(16) : null;

  const order = await Order.create({
    customer: body.customer,
    type: body.type,
    address: isDelivery ? (body.address || "") : null,
    cart: body.cart,
    pricing: body.pricing,
    acceptance: "pending",
    status: "new",
    customerToken,
  });

  return res.status(201).json({
    orderId: order._id.toString(),
    customerToken,
  });
});

// Public tracking read (delivery only) by token
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const token = String(req.query.token || "");
  const order = await Order.findById(id).lean();
  if (!order) return res.status(404).json({ error: "Not found" });

  if (order.type !== "Delivery") return res.status(403).json({ error: "Tracking is delivery-only" });
  if (!order.customerToken || token !== order.customerToken) return res.status(401).json({ error: "Bad token" });

  // Hide internal acceptance wording; keep neutral.
  const safe = { ...order };
  delete safe.customerToken;
  delete safe.riderToken;
  return res.json({ order: safe });
});

// Customer location updates during delivery
router.patch("/:id/customer-location", async (req, res) => {
  const { id } = req.params;
  const token = String(req.query.token || "");
  const schema = z.object({
    lat: z.number(),
    lng: z.number(),
    accuracy: z.number().optional().nullable(),
    updatedAtMs: z.number().int(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const order = await Order.findById(id);
  if (!order) return res.status(404).json({ error: "Not found" });
  if (order.type !== "Delivery") return res.status(403).json({ error: "Delivery-only" });
  if (!order.customerToken || token !== order.customerToken) return res.status(401).json({ error: "Bad token" });

  order.customerLocation = parsed.data;
  await order.save();
  return res.json({ ok: true });
});

module.exports = router;

