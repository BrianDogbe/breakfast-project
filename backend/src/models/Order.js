const mongoose = require("mongoose");

const LocationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: null },
    updatedAtMs: { type: Number, required: true },
  },
  { _id: false },
);

const CartLineSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true },
    name: { type: String, required: true },
    unitPrice: { type: Number, required: true },
    qty: { type: Number, required: true, min: 1 },
    notes: { type: String, default: "" },
    lineTotal: { type: Number, required: true },
  },
  { _id: false },
);

const OrderSchema = new mongoose.Schema(
  {
    customer: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
    },
    type: { type: String, enum: ["Dine-In", "Pickup", "Delivery"], required: true },
    address: { type: String, default: null },
    cart: { type: [CartLineSchema], default: [] },
    pricing: {
      subtotal: { type: Number, required: true },
      deliveryFee: { type: Number, required: true },
      total: { type: Number, required: true },
      currency: { type: String, default: "GHS" },
    },
    acceptance: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
    status: {
      type: String,
      enum: ["new", "confirmed", "preparing", "ready", "picked_up", "en_route", "completed", "cancelled"],
      default: "new",
    },
    estimatedReadyAt: { type: Date, default: null },
    prepNotes: { type: String, default: "" },
    rider: {
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
    },
    customerToken: { type: String, default: null, index: true },
    riderToken: { type: String, default: null, index: true },
    customerLocation: { type: LocationSchema, default: null },
    riderLocation: { type: LocationSchema, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Order", OrderSchema);

