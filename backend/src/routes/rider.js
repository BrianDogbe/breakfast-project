const express = require("express");
const { z } = require("zod");
const Order = require("../models/Order");

const router = express.Router();

router.patch("/:id/location", async (req, res) => {
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
  if (!order.riderToken || token !== order.riderToken) return res.status(401).json({ error: "Bad token" });

  order.riderLocation = parsed.data;
  await order.save();
  return res.json({ ok: true });
});

module.exports = router;

