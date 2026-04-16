(function () {
  const API_BASE = String(window.BREAKFAST_API_BASE || "http://127.0.0.1:4000").replace(/\/$/, "");

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const orderId = params.get("order") || "";
  const token = params.get("token") || "";

  $("order-id").textContent = orderId ? orderId.slice(0, 8) + "…" : "—";

  let watchId = null;
  let lastSentAt = 0;

  const map = L.map("map", { zoomControl: true }).setView([5.6037, -0.187], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  const riderMarker = L.marker([5.6037, -0.187]).addTo(map).bindPopup("Rider");

  function setStatus(text) {
    $("status").textContent = text;
  }

  async function sendLocation(lat, lng, accuracy) {
    if (!orderId || !token) return;
    const now = Date.now();
    if (now - lastSentAt < 8000) return;
    lastSentAt = now;
    try {
      const res = await fetch(
        API_BASE + "/api/rider/" + encodeURIComponent(orderId) + "/location?token=" + encodeURIComponent(token),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: lat, lng: lng, accuracy: accuracy || null, updatedAtMs: now }),
        },
      );
      if (!res.ok) throw new Error("bad status");
      setStatus("Sharing live location…");
    } catch (e) {
      console.error(e);
      setStatus("Could not send location (bad link/token/network?).");
    }
  }

  function start() {
    if (!orderId || !token) {
      setStatus("Missing order/token. Ask admin for the rider link.");
      return;
    }
    if (!navigator.geolocation) {
      setStatus("Geolocation not supported on this device.");
      return;
    }
    $("btn-stop").disabled = false;

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        riderMarker.setLatLng([latitude, longitude]);
        map.setView([latitude, longitude], Math.max(map.getZoom(), 15));
        sendLocation(latitude, longitude, accuracy);
      },
      (err) => {
        console.error(err);
        setStatus("Location permission denied / unavailable.");
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
  }

  function stop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    $("btn-stop").disabled = true;
    setStatus("Stopped.");
  }

  $("btn-stop").addEventListener("click", stop);
  start();
})();
