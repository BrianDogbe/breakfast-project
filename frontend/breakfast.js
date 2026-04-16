document.addEventListener("DOMContentLoaded", function () {
  const API_BASE = String(window.BREAKFAST_API_BASE || "http://127.0.0.1:4000").replace(/\/$/, "");
  const DELIVERY_FEE = 10;

  const yearSpan = document.getElementById("year");
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

  const contactForm = document.getElementById("contact-form");
  const contactStatus = document.getElementById("form-status");

  if (contactForm) {
    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();

      const name = document.getElementById("name").value;
      const email = document.getElementById("email").value;
      const message = document.getElementById("message").value;

      fetch(API_BASE + "/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, email: email, message: message }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("bad status");
          return r.json();
        })
        .then(function () {
          if (contactStatus) contactStatus.textContent = "Message sent successfully!";
          contactForm.reset();
        })
        .catch(function (error) {
          console.error("Error:", error);
          if (contactStatus) contactStatus.textContent = "Error sending message.";
        });
    });
  }

  const reservationForm = document.getElementById("reservation-form");
  const reservationStatus = document.getElementById("reservation-status");

  const cart = [];

  const menuRoot = document.getElementById("menu-cards");
  const foodPicker = document.getElementById("food-picker");
  const openCustomizeBtn = document.getElementById("open-customize");
  const cartItemsEl = document.getElementById("cart-items");
  const cartEmptyEl = document.getElementById("cart-empty");
  const clearCartBtn = document.getElementById("clear-cart");
  const subtotalEl = document.getElementById("cart-subtotal");
  const deliveryEl = document.getElementById("cart-delivery");
  const totalEl = document.getElementById("cart-total");

  const sheet = document.getElementById("item-sheet");
  const sheetBackdrop = document.getElementById("sheet-backdrop");
  const sheetClose = document.getElementById("sheet-close");
  const sheetTitle = document.getElementById("sheet-title");
  const sheetDesc = document.getElementById("sheet-desc");
  const qtyDec = document.getElementById("qty-dec");
  const qtyInc = document.getElementById("qty-inc");
  const qtyValue = document.getElementById("qty-value");
  const optNotes = document.getElementById("opt-notes");
  const sheetTotal = document.getElementById("sheet-total");
  const addToCartBtn = document.getElementById("add-to-cart");

  const resType = document.getElementById("res-type");

  let activeItem = null;
  let activeQty = 1;

  function formatGhs(amount) {
    return `GHS ${amount.toFixed(2)}`;
  }

  function calcSheetTotal() {
    if (!activeItem) return 0;
    return activeItem.price * activeQty;
  }

  function updateSheetUi() {
    if (!activeItem) return;
    qtyValue.textContent = String(activeQty);
    sheetTotal.textContent = formatGhs(calcSheetTotal());
    if (sheetTitle) sheetTitle.textContent = activeItem.name;
    if (sheetDesc) sheetDesc.textContent = `Base price: ${formatGhs(activeItem.price)}`;
  }

  function openSheet(item) {
    activeItem = item;
    activeQty = 1;
    if (optNotes) optNotes.value = "";

    updateSheetUi();

    if (sheetBackdrop) sheetBackdrop.hidden = false;
    if (sheet) {
      sheet.hidden = false;
      sheet.setAttribute("aria-hidden", "false");
    }
  }

  function closeSheet() {
    if (sheetBackdrop) sheetBackdrop.hidden = true;
    if (sheet) {
      sheet.hidden = true;
      sheet.setAttribute("aria-hidden", "true");
    }
    activeItem = null;
  }

  closeSheet();

  function getItemFromCard(card) {
    if (!card) return null;
    return {
      id: card.getAttribute("data-item-id"),
      name: card.getAttribute("data-item-name"),
      price: Number(card.getAttribute("data-item-price") || "0"),
      group: card.getAttribute("data-menu-group") || "more",
    };
  }

  function getItemFromPicker() {
    if (!foodPicker || !foodPicker.value) return null;
    const card = menuRoot && menuRoot.querySelector(`.menu-card[data-item-id="${foodPicker.value}"]`);
    return getItemFromCard(card);
  }

  const MENU_GROUP_ORDER = ["sandwiches", "shawarma", "more", "drinks"];
  const MENU_GROUP_LABELS = {
    sandwiches: "Sandwiches",
    shawarma: "Shawarma",
    more: "Bowls & more",
    drinks: "Coffee & juice",
  };

  function syncPickerFromCards() {
    if (!foodPicker || !menuRoot) return;
    foodPicker.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Pick a category, then a dish…";
    foodPicker.appendChild(placeholder);

    const byGroup = {};
    MENU_GROUP_ORDER.forEach((key) => {
      byGroup[key] = [];
    });

    menuRoot.querySelectorAll(".menu-card").forEach((card) => {
      const id = card.getAttribute("data-item-id");
      if (!id) return;
      const group = card.getAttribute("data-menu-group") || "more";
      if (!byGroup[group]) byGroup[group] = [];
      byGroup[group].push({
        id,
        name: card.getAttribute("data-item-name") || id,
      });
    });

    MENU_GROUP_ORDER.forEach((groupKey) => {
      const items = byGroup[groupKey];
      if (!items || items.length === 0) return;
      const og = document.createElement("optgroup");
      og.label = MENU_GROUP_LABELS[groupKey] || groupKey;
      items.forEach(({ id, name }) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name;
        og.appendChild(opt);
      });
      foodPicker.appendChild(og);
    });
  }

  function updateSelectedCardHighlight() {
    if (!menuRoot) return;
    const id = foodPicker ? foodPicker.value : "";
    menuRoot.querySelectorAll(".menu-card").forEach((card) => {
      card.classList.toggle("is-selected", id && card.getAttribute("data-item-id") === id);
    });
  }

  function updateCustomizeButtonState() {
    if (openCustomizeBtn) {
      openCustomizeBtn.disabled = !foodPicker || !foodPicker.value;
    }
  }

  syncPickerFromCards();
  updateCustomizeButtonState();

  function computeCartSubtotal() {
    return cart.reduce((sum, line) => sum + line.lineTotal, 0);
  }

  function computeDeliveryFee() {
    return resType && resType.value === "Delivery" ? DELIVERY_FEE : 0;
  }

  function renderCart() {
    if (!cartItemsEl || !subtotalEl || !deliveryEl || !totalEl) return;

    cartItemsEl.innerHTML = "";
    if (cart.length === 0) {
      if (cartEmptyEl) cartItemsEl.appendChild(cartEmptyEl);
      if (cartEmptyEl) cartEmptyEl.style.display = "block";
    } else {
      if (cartEmptyEl) cartEmptyEl.style.display = "none";
      cart.forEach((line, idx) => {
        const el = document.createElement("div");
        el.className = "cart-item";

        const notesText = line.notes ? `Notes: ${line.notes}` : "";

        el.innerHTML = `
          <div>
            <strong>${line.qty}× ${line.name}</strong>
          </div>
          <div><strong>${formatGhs(line.lineTotal)}</strong></div>
          <div class="sub">${notesText ? notesText : ""}</div>
          <div class="actions">
            <button type="button" class="mini-btn" data-action="remove" data-idx="${idx}">Remove</button>
            <div class="row" style="gap:0.5rem;">
              <button type="button" class="mini-btn" data-action="dec" data-idx="${idx}">−</button>
              <span><strong>${line.qty}</strong></span>
              <button type="button" class="mini-btn" data-action="inc" data-idx="${idx}">+</button>
            </div>
          </div>
        `;

        cartItemsEl.appendChild(el);
      });
    }

    const subtotal = computeCartSubtotal();
    const deliveryFee = computeDeliveryFee();
    subtotalEl.textContent = formatGhs(subtotal);
    deliveryEl.textContent = formatGhs(deliveryFee);
    totalEl.textContent = formatGhs(subtotal + deliveryFee);
  }

  function addActiveToCart() {
    if (!activeItem) return;
    const notes = optNotes ? optNotes.value.trim() : "";
    const lineTotal = activeItem.price * activeQty;
    cart.push({
      itemId: activeItem.id,
      name: activeItem.name,
      unitPrice: activeItem.price,
      qty: activeQty,
      notes: notes,
      lineTotal: lineTotal,
    });
    closeSheet();
    renderCart();
    document.getElementById("order")?.scrollIntoView({ behavior: "smooth" });
  }

  if (foodPicker) {
    foodPicker.addEventListener("change", () => {
      updateSelectedCardHighlight();
      updateCustomizeButtonState();
    });
  }

  if (openCustomizeBtn) {
    openCustomizeBtn.addEventListener("click", () => {
      const item = getItemFromPicker();
      if (item && item.id) openSheet(item);
    });
  }

  if (qtyDec) {
    qtyDec.addEventListener("click", () => {
      activeQty = Math.max(1, activeQty - 1);
      updateSheetUi();
    });
  }
  if (qtyInc) {
    qtyInc.addEventListener("click", () => {
      activeQty = Math.min(20, activeQty + 1);
      updateSheetUi();
    });
  }

  if (sheetClose) sheetClose.addEventListener("click", closeSheet);
  if (sheetBackdrop) sheetBackdrop.addEventListener("click", closeSheet);
  if (addToCartBtn) addToCartBtn.addEventListener("click", addActiveToCart);

  if (clearCartBtn) {
    clearCartBtn.addEventListener("click", () => {
      cart.length = 0;
      renderCart();
    });
  }

  if (cartItemsEl) {
    cartItemsEl.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("button[data-action]") : null;
      if (!btn) return;
      const idx = Number(btn.getAttribute("data-idx"));
      const action = btn.getAttribute("data-action");
      const line = cart[idx];
      if (!line) return;

      if (action === "remove") {
        cart.splice(idx, 1);
      } else if (action === "inc") {
        line.qty += 1;
      } else if (action === "dec") {
        line.qty = Math.max(1, line.qty - 1);
      }

      line.lineTotal = line.unitPrice * line.qty;
      renderCart();
    });
  }

  if (resType) {
    resType.addEventListener("change", renderCart);
  }

  renderCart();

  if (reservationForm) {
    reservationForm.addEventListener("submit", function (e) {
      e.preventDefault();

      if (reservationStatus) reservationStatus.textContent = "";

      const name = document.getElementById("res-name").value.trim();
      const phone = document.getElementById("res-phone").value.trim();
      const type = document.getElementById("res-type").value;
      const address = document.getElementById("res-address").value.trim();

      if (cart.length === 0) {
        if (reservationStatus) reservationStatus.textContent = "Your cart is empty. Add items from the menu.";
        return;
      }

      if (type === "Delivery" && !address) {
        if (reservationStatus) reservationStatus.textContent = "Please enter a delivery address.";
        return;
      }

      const subtotal = computeCartSubtotal();
      const deliveryFee = computeDeliveryFee();
      const total = subtotal + deliveryFee;

      fetch(API_BASE + "/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: { name: name, phone: phone },
          type: type,
          address: type === "Delivery" ? address : null,
          cart: cart,
          pricing: { subtotal: subtotal, deliveryFee: deliveryFee, total: total, currency: "GHS" },
        }),
      })
        .then(function (r) {
          if (!r.ok)
            return r.json().then(function (j) {
              throw new Error((j && j.error) || "Order failed");
            });
          return r.json();
        })
        .then(function (body) {
          if (reservationStatus) {
            reservationStatus.textContent =
              "Order sent! You can follow progress below—stay on this page for live updates.";
          }
          reservationForm.reset();
          cart.length = 0;
          renderCart();
          if (type === "Delivery" && body && body.orderId && body.customerToken) {
            startOrderTracking(body.orderId, body.customerToken);
          } else {
            stopOrderTrackingUi();
          }
        })
        .catch(function (error) {
          console.error("Error:", error);
          if (reservationStatus) reservationStatus.textContent = "Error saving order.";
        });
    });
  }

  /* --------- Live order tracking (Bolt-style, neutral until kitchen starts) --------- */
  const ORDER_TRACK_KEY = "bite_sips_track_order_id";
  const ORDER_TRACK_TOKEN_KEY = "bite_sips_track_order_token";
  const orderTrackPanel = document.getElementById("order-track-panel");
  const orderTrackLead = document.getElementById("order-track-lead");
  const orderTrackEta = document.getElementById("order-track-eta");
  const orderTrackTimeline = document.getElementById("order-track-timeline");
  const orderTrackDismiss = document.getElementById("order-track-dismiss");
  const orderTrackMapWrap = document.getElementById("order-track-map-wrap");
  const orderTrackMapHint = document.getElementById("order-track-map-hint");
  const orderTrackRider = document.getElementById("order-track-rider");
  const orderTrackRiderName = document.getElementById("order-track-rider-name");
  const orderTrackRiderPhone = document.getElementById("order-track-rider-phone");
  const orderTrackCallRider = document.getElementById("order-track-call-rider");
  let orderTrackPollTimer = null;
  let orderGeoWatchId = null;
  let lastCustomerLocSentAt = 0;
  let trackMap = null;
  let driverMarker = null;
  let customerMarker = null;

  function normalizeAcceptanceOrder(a) {
    if (a === "pending" || a === "accepted" || a === "declined") return a;
    return "accepted";
  }

  function normalizeOrderStatus(s) {
    const allowed = ["new", "confirmed", "preparing", "ready", "picked_up", "en_route", "completed", "cancelled"];
    const v = String(s || "").toLowerCase();
    return allowed.indexOf(v) !== -1 ? v : "new";
  }

  function getCustomerPhase(data) {
    const acceptance = normalizeAcceptanceOrder(data.acceptance);
    const st = normalizeOrderStatus(data.status);
    if (acceptance === "declined" || st === "cancelled") return "closed";
    if (acceptance === "pending") return "waiting_review";
    if (st === "new" || st === "confirmed") return "waiting_kitchen";
    if (st === "preparing") return "preparing";
    if (st === "ready") return "ready";
    if (st === "picked_up") return "picked_up";
    if (st === "en_route") return "en_route";
    if (st === "completed") return "done";
    return "waiting_kitchen";
  }

  function getTrackSteps(isDelivery) {
    if (isDelivery) {
      return [
        { label: "Order received" },
        { label: "Preparing your food" },
        { label: "Ready" },
        { label: "Picked up" },
        { label: "On the way" },
        { label: "Delivered" },
      ];
    }
    return [
      { label: "Order received" },
      { label: "Preparing your food" },
      { label: "Ready for pickup" },
      { label: "Completed" },
    ];
  }

  function phaseToStepIndex(phase, isDelivery) {
    if (phase === "closed") return -1;
    if (phase === "waiting_review" || phase === "waiting_kitchen") return 0;
    if (phase === "preparing") return 1;
    if (phase === "ready") return 2;
    if (phase === "picked_up") return isDelivery ? 3 : 2;
    if (phase === "en_route") return isDelivery ? 4 : 2;
    if (phase === "done") return isDelivery ? 5 : 3;
    return 0;
  }

  function formatEtaLine(ts) {
    try {
      if (!ts) return "";
      const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
      if (Number.isNaN(d.getTime())) return "";
      return (
        "Estimated ready around " +
        d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      );
    } catch (e) {
      return "";
    }
  }

  function renderOrderTimeline(phase, isDelivery) {
    if (!orderTrackTimeline) return;
    if (
      phase === "closed" ||
      phase === "waiting_review" ||
      phase === "waiting_kitchen"
    ) {
      orderTrackTimeline.innerHTML = "";
      orderTrackTimeline.hidden = true;
      return;
    }
    orderTrackTimeline.hidden = false;
    const steps = getTrackSteps(isDelivery);
    const idx = phaseToStepIndex(phase, isDelivery);
    orderTrackTimeline.innerHTML = steps
      .map(function (step, i) {
        var state = "upcoming";
        if (phase === "done") state = "done";
        else if (i < idx) state = "done";
        else if (i === idx) {
          state =
            phase === "waiting_review" || phase === "waiting_kitchen" ? "waiting" : "current";
        } else state = "upcoming";
        return '<li class="timeline-step timeline-step--' + state + '"><span>' + step.label + "</span></li>";
      })
      .join("");
  }

  function renderOrderTrack(data) {
    if (!orderTrackLead) return;
    var phase = getCustomerPhase(data);
    var isDelivery = data.type === "Delivery";
    var lead = "";
    if (phase === "closed") {
      lead =
        "We couldn’t complete this order. If anything was charged in error, please call us—we’re happy to help.";
    } else if (phase === "waiting_review") {
      lead = "We received your order. Hang tight while we line everything up in the kitchen.";
    } else if (phase === "waiting_kitchen") {
      lead = "You’re in the queue. We’ll share live progress as soon as cooking starts.";
    } else if (phase === "preparing") {
      lead = "Your food is being prepared.";
    } else if (phase === "ready") {
      lead = isDelivery
        ? "Your order is packed and will be on its way shortly."
        : "Your order is ready for collection.";
    } else if (phase === "picked_up") {
      lead = "A rider has picked up your order.";
    } else if (phase === "en_route") {
      lead = "Your order is on the way.";
    } else if (phase === "done") {
      lead = "Order complete. Thanks for choosing Bite & Sips!";
    }
    orderTrackLead.textContent = lead;

    // Rider info (only when delivery is active).
    if (orderTrackRider) {
      if (isDelivery && (phase === "picked_up" || phase === "en_route")) {
        const rider = data.rider || {};
        const rName = rider.name || "Rider";
        const rPhone = rider.phone || "";
        orderTrackRider.hidden = false;
        if (orderTrackRiderName) orderTrackRiderName.textContent = rName;
        if (orderTrackRiderPhone) orderTrackRiderPhone.textContent = rPhone ? rPhone : "";
        if (orderTrackCallRider) {
          if (rPhone) {
            orderTrackCallRider.hidden = false;
            orderTrackCallRider.setAttribute("href", "tel:" + rPhone);
          } else {
            orderTrackCallRider.hidden = true;
            orderTrackCallRider.setAttribute("href", "#");
          }
        }
      } else {
        orderTrackRider.hidden = true;
      }
    }

    var showEta =
      phase !== "closed" &&
      phase !== "waiting_review" &&
      phase !== "waiting_kitchen" &&
      data.estimatedReadyAt;
    if (orderTrackEta) {
      if (showEta) {
        var etaText = formatEtaLine(data.estimatedReadyAt);
        orderTrackEta.textContent = etaText;
        orderTrackEta.hidden = false;
      } else {
        orderTrackEta.textContent = "";
        orderTrackEta.hidden = true;
      }
    }

    renderOrderTimeline(phase, isDelivery);
  }

  function detachOrderListener() {
    if (orderTrackPollTimer) {
      clearInterval(orderTrackPollTimer);
      orderTrackPollTimer = null;
    }
  }

  function stopOrderTrackingUi() {
    detachOrderListener();
    if (orderGeoWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(orderGeoWatchId);
      orderGeoWatchId = null;
    }
    try {
      localStorage.removeItem(ORDER_TRACK_KEY);
      localStorage.removeItem(ORDER_TRACK_TOKEN_KEY);
    } catch (e) {}
    if (orderTrackPanel) orderTrackPanel.hidden = true;
    if (orderTrackDismiss) orderTrackDismiss.hidden = true;
  }

  function ensureMap() {
    if (!orderTrackMapWrap) return;
    if (trackMap) return;
    if (typeof L === "undefined") return;
    orderTrackMapWrap.hidden = false;
    trackMap = L.map("order-track-map", { zoomControl: true }).setView([5.6037, -0.187], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(trackMap);
    driverMarker = L.marker([5.6037, -0.187]).addTo(trackMap).bindPopup("Driver");
    customerMarker = L.marker([5.6037, -0.187]).addTo(trackMap).bindPopup("You");
  }

  function maybeStartCustomerLocationUpdates(orderId, token) {
    if (!navigator.geolocation) return;
    if (orderGeoWatchId != null) return;
    if (!orderId || !token) return;
    orderGeoWatchId = navigator.geolocation.watchPosition(
      function (pos) {
        var now = Date.now();
        if (now - lastCustomerLocSentAt < 10000) return;
        lastCustomerLocSentAt = now;
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        var accuracy = pos.coords.accuracy;
        fetch(
          API_BASE +
            "/api/orders/" +
            encodeURIComponent(orderId) +
            "/customer-location?token=" +
            encodeURIComponent(token),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lat: lat,
              lng: lng,
              accuracy: accuracy || null,
              updatedAtMs: now,
            }),
          },
        ).catch(function () {});
      },
      function () {},
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 },
    );
  }

  function updateMapFromOrder(data) {
    if (!orderTrackMapWrap) return;
    var isDelivery = data.type === "Delivery";
    var phase = getCustomerPhase(data);
    if (!isDelivery || (phase !== "en_route" && phase !== "picked_up")) {
      orderTrackMapWrap.hidden = true;
      return;
    }
    ensureMap();
    if (!trackMap) return;
    orderTrackMapWrap.hidden = false;
    if (orderTrackMapHint) orderTrackMapHint.textContent = "Live delivery in progress.";

    if (data.riderLocation && typeof data.riderLocation.lat === "number") {
      driverMarker.setLatLng([data.riderLocation.lat, data.riderLocation.lng]);
    }
    if (data.customerLocation && typeof data.customerLocation.lat === "number") {
      customerMarker.setLatLng([data.customerLocation.lat, data.customerLocation.lng]);
    }

    try {
      var group = L.featureGroup([driverMarker, customerMarker]);
      trackMap.fitBounds(group.getBounds().pad(0.25));
    } catch (e) {}
  }

  function startOrderTracking(orderId, customerToken) {
    if (!orderId || !orderTrackPanel) return;
    detachOrderListener();
    try {
      localStorage.setItem(ORDER_TRACK_KEY, orderId);
      if (customerToken) localStorage.setItem(ORDER_TRACK_TOKEN_KEY, customerToken);
    } catch (e) {}
    orderTrackPanel.hidden = false;
    if (orderTrackDismiss) orderTrackDismiss.hidden = false;

    function applyOrderPayload(data) {
      if (!data) {
        if (orderTrackLead) orderTrackLead.textContent = "We couldn’t find this order anymore.";
        return;
      }
      // Tracking UI is for Delivery orders only.
      if (data.type !== "Delivery") {
        stopOrderTrackingUi();
        return;
      }
      renderOrderTrack(data);
      updateMapFromOrder(data);
      // Only start sharing the customer's location during active delivery.
      var phase = getCustomerPhase(data);
      if (data.type === "Delivery" && (phase === "picked_up" || phase === "en_route")) {
        var token = customerToken;
        if (!token) {
          try {
            token = localStorage.getItem(ORDER_TRACK_TOKEN_KEY) || "";
          } catch (e) {}
        }
        maybeStartCustomerLocationUpdates(orderId, token);
        if (orderTrackMapHint) {
          orderTrackMapHint.textContent = "Allow location to show your position and the rider on the map.";
        }
      }
    }

    function pollOnce() {
      var tok = customerToken;
      if (!tok) {
        try {
          tok = localStorage.getItem(ORDER_TRACK_TOKEN_KEY) || "";
        } catch (e) {}
      }
      if (!tok) return;
      fetch(API_BASE + "/api/orders/" + encodeURIComponent(orderId) + "?token=" + encodeURIComponent(tok))
        .then(function (r) {
          if (r.status === 404) return null;
          if (!r.ok) throw new Error("track");
          return r.json();
        })
        .then(function (body) {
          if (!body || !body.order) return;
          applyOrderPayload(body.order);
        })
        .catch(function (err) {
          console.error(err);
        });
    }

    pollOnce();
    orderTrackPollTimer = setInterval(pollOnce, 4000);
  }

  if (orderTrackDismiss) {
    orderTrackDismiss.addEventListener("click", function () {
      stopOrderTrackingUi();
    });
  }

  try {
    var savedOrderId = localStorage.getItem(ORDER_TRACK_KEY);
    var savedToken = localStorage.getItem(ORDER_TRACK_TOKEN_KEY);
    if (savedOrderId) startOrderTracking(savedOrderId, savedToken);
  } catch (e) {}
});

