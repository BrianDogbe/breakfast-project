const express = require("express");
const cors = require("cors");
const dns = require("dns");
require("dotenv").config();

const { connectDb } = require("./db");
const publicOrders = require("./routes/publicOrders");
const riderRoutes = require("./routes/rider");
const adminRoutes = require("./routes/admin");
const contactRoutes = require("./routes/contact");

async function main() {
  const app = express();

  // Fix for networks/DNS setups where Node cannot resolve MongoDB SRV records reliably.
  // If DNS_SERVERS is set, we use it. Otherwise we default to public resolvers.
  // Example: DNS_SERVERS=8.8.8.8,1.1.1.1
  try {
    const raw = String(process.env.DNS_SERVERS || "").trim();
    const servers =
      raw.length > 0
        ? raw.split(",").map((s) => s.trim()).filter(Boolean)
        : ["8.8.8.8", "1.1.1.1"];
    dns.setServers(servers);
  } catch (e) {
    // ignore
  }

  const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: function (origin, cb) {
        // allow curl/postman/no-origin + any configured origins
        if (!origin) return cb(null, true);
        // file:// pages send Origin: "null"
        if (origin === "null") return cb(null, true);
        if (allowedOrigins.length === 0) return cb(null, true);
        return cb(null, allowedOrigins.includes(origin));
      },
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => res.json({ ok: true }));

  app.use("/api/orders", publicOrders);
  app.use("/api/rider", riderRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/contact", contactRoutes);

  const port = parseInt(process.env.PORT || "4000", 10);

  await connectDb(process.env.MONGODB_URI);

  app.listen(port, () => {
    console.log(`API listening on http://127.0.0.1:${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

