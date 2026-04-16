const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const Order = require("../models/Order");
const ContactMessage = require("../models/ContactMessage");
const { adminAuth } = require("../middleware/adminAuth");
const { makeToken } = require("../utils/tokens");

const router = express.Router();

router.post("/login", async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const { email, password } = parsed.data;
  if (email.toLowerCase() !== String(process.env.ADMIN_EMAIL || "").toLowerCase()) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  // Support either ADMIN_PASSWORD_HASH or ADMIN_PASSWORD for the bcrypt hash,
  // since earlier setups used ADMIN_PASSWORD as the hash field name.
  const hash = String(process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD || "");
  if (!hash) return res.status(500).json({ error: "Server not configured (missing admin password hash)" });
  const ok = await bcrypt.compare(password, hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ role: "admin", email }, process.env.JWT_SECRET, { expiresIn: "12h" });
  return res.json({ token });
});

router.get("/orders", adminAuth, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : "";
  const type = req.query.type ? String(req.query.type) : "";
  const q = req.query.q ? String(req.query.q).trim() : "";

  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (q) {
    filter.$or = [
      { "customer.name": new RegExp(q, "i") },
      { "customer.phone": new RegExp(q, "i") },
      { _id: q.match(/^[0-9a-fA-F]{24}$/) ? q : undefined },
    ].filter(Boolean);
  }

  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(250).lean();
  return res.json({ orders });
});

router.patch("/orders/:id", adminAuth, async (req, res) => {
  const { id } = req.params;
  const schema = z.object({
    acceptance: z.enum(["pending", "accepted", "declined"]).optional(),
    status: z.enum(["new", "confirmed", "preparing", "ready", "picked_up", "en_route", "completed", "cancelled"]).optional(),
    prepNotes: z.string().optional(),
    estimatedReadyAt: z.union([z.string(), z.null()]).optional(),
    rider: z.object({ name: z.string().optional(), phone: z.string().optional() }).optional(),
    customer: z.object({ name: z.string().min(1), phone: z.string().min(1) }).optional(),
    type: z.enum(["Dine-In", "Pickup", "Delivery"]).optional(),
    address: z.union([z.string(), z.null()]).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const patch = parsed.data;
  const order = await Order.findById(id);
  if (!order) return res.status(404).json({ error: "Not found" });

  if (patch.acceptance) order.acceptance = patch.acceptance;
  if (patch.status) order.status = patch.status;
  if (typeof patch.prepNotes === "string") order.prepNotes = patch.prepNotes;
  if (patch.estimatedReadyAt === null) order.estimatedReadyAt = null;
  if (typeof patch.estimatedReadyAt === "string") {
    const d = new Date(patch.estimatedReadyAt);
    order.estimatedReadyAt = Number.isNaN(d.getTime()) ? null : d;
  }
  if (patch.rider) {
    order.rider = {
      name: patch.rider.name || order.rider?.name || "",
      phone: patch.rider.phone || order.rider?.phone || "",
    };
  }
  if (patch.customer) order.customer = patch.customer;
  if (patch.type) {
    order.type = patch.type;
    if (patch.type !== "Delivery") order.address = null;
  }
  if (patch.address !== undefined && order.type === "Delivery") {
    order.address = patch.address || "";
  }

  // If accepted and delivery, ensure riderToken exists for rider link.
  if (order.type === "Delivery" && order.acceptance === "accepted" && !order.riderToken) {
    order.riderToken = makeToken(16);
  }

  await order.save();
  return res.json({ order });
});

router.post("/orders/:id/regenerate-rider-token", adminAuth, async (req, res) => {
  const { id } = req.params;
  const order = await Order.findById(id);
  if (!order) return res.status(404).json({ error: "Not found" });
  if (order.type !== "Delivery") return res.status(400).json({ error: "Not a delivery order" });
  order.riderToken = makeToken(16);
  order.riderLocation = null;
  await order.save();
  return res.json({ riderToken: order.riderToken });
});

router.delete("/orders/:id", adminAuth, async (req, res) => {
  const { id } = req.params;
  await Order.deleteOne({ _id: id });
  return res.json({ ok: true });
});

router.get("/contact-messages", adminAuth, async (req, res) => {
  const messages = await ContactMessage.find().sort({ createdAt: -1 }).limit(100).lean();
  return res.json({ messages });
});

router.delete("/contact-messages/:id", adminAuth, async (req, res) => {
  const { id } = req.params;
  await ContactMessage.deleteOne({ _id: id });
  return res.json({ ok: true });
});

module.exports = router;

