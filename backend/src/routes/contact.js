const express = require("express");
const { z } = require("zod");
const ContactMessage = require("../models/ContactMessage");

const router = express.Router();

const Body = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  message: z.string().min(1),
});

router.post("/", async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const doc = await ContactMessage.create(parsed.data);
  return res.status(201).json({ id: doc._id.toString() });
});

module.exports = router;
