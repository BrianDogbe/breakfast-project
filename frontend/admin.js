(function () {
  const API_BASE = String(window.BREAKFAST_API_BASE || "http://127.0.0.1:4000").replace(/\/$/, "");
  const ADMIN_TOKEN_KEY = "bite_sips_admin_token";

  const STATUSES = [
    { value: "new", label: "New" },
    { value: "confirmed", label: "Confirmed" },
    { value: "preparing", label: "Preparing" },
    { value: "ready", label: "Ready for pickup / serve" },
    { value: "picked_up", label: "Picked up by rider" },
    { value: "en_route", label: "Out for delivery" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ];

  let rawOrders = [];
  let rawMessages = [];
  const selectedIds = new Set();
  let ordersPollTimer = null;
  let messagesPollTimer = null;
  // Track initial snapshot so we only play sounds on NEW orders later.
  let ordersSoundInitialized = false;
  let ordersSoundSeenIds = new Set();

  const $ = (id) => document.getElementById(id);

  function getAdminToken() {
    try {
      return localStorage.getItem(ADMIN_TOKEN_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function setAdminToken(token) {
    try {
      if (!token) localStorage.removeItem(ADMIN_TOKEN_KEY);
      else localStorage.setItem(ADMIN_TOKEN_KEY, token);
    } catch (e) {}
  }

  function apiFetch(path, opts) {
    const token = getAdminToken();
    const headers = Object.assign({ "Content-Type": "application/json" }, (opts && opts.headers) || {});
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(API_BASE + path, Object.assign({}, opts || {}, { headers: headers }));
  }

  function normalizeStatus(s) {
    if (!s || s === "") return "new";
    const v = String(s).toLowerCase();
    return STATUSES.some((x) => x.value === v) ? v : "new";
  }

  function normalizeAcceptance(a) {
    if (a === "pending" || a === "accepted" || a === "declined") return a;
    return "accepted";
  }

  function dateToTimeValue(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function timeValueToNextDate(timeStr) {
    // timeStr: "HH:MM"
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || "").trim());
    if (!m) return null;
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));

    const now = new Date();
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setHours(hh, mm, 0, 0);
    // If the chosen time already passed today, roll to tomorrow.
    if (d.getTime() < now.getTime() - 30 * 1000) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  function makeToken() {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch (e) {
      return String(Math.random()).slice(2) + String(Date.now());
    }
  }

  function statusLabel(val) {
    const f = STATUSES.find((x) => x.value === val);
    return f ? f.label : val;
  }

  function fmtMoney(n) {
    const x = typeof n === "number" ? n : parseFloat(n) || 0;
    return `GHS ${x.toFixed(2)}`;
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch (e) {
      return "—";
    }
  }

  function playOrderSound() {
    const audio = $("order-sound");
    if (audio) {
      try {
        audio.currentTime = 0;
        const p = audio.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
        return;
      } catch (e) {
        // Fall through to beep fallback.
      }
    }

    // Fallback beep if the audio file is missing/unavailable.
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => {
        try {
          osc.stop();
        } catch (e) {}
        try {
          ctx.close();
        } catch (e) {}
      }, 180);
    } catch (e) {
      // Ignore
    }
  }

  function fillStatusSelect(el, includeEmpty) {
    el.innerHTML = "";
    if (includeEmpty) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "All statuses";
      el.appendChild(o);
    }
    STATUSES.forEach(({ value, label }) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      el.appendChild(o);
    });
  }

  function badgeClassForStatus(st) {
    const m = {
      new: "badge-st-new",
      confirmed: "badge-st-confirmed",
      preparing: "badge-st-preparing",
      ready: "badge-st-ready",
      picked_up: "badge-st-enroute",
      en_route: "badge-st-enroute",
      completed: "badge-st-completed",
      cancelled: "badge-st-cancelled",
    };
    return m[st] || "badge-st-new";
  }

  function badgeClassForType(t) {
    if (t === "Dine-In") return "badge-type-dine";
    if (t === "Pickup") return "badge-type-pickup";
    if (t === "Delivery") return "badge-type-delivery";
    return "badge-type-pickup";
  }

  function cartSummaryLines(cart) {
    if (!Array.isArray(cart) || cart.length === 0) return "No line items";
    return cart
      .map((line) => {
        const addons = (line.addons || []).map((a) => a.label).join(", ");
        const bits = [line.qty + "× " + (line.name || "?")];
        if (addons) bits.push("(" + addons + ")");
        if (line.notes) bits.push("— " + line.notes);
        return bits.join(" ");
      })
      .join(" · ");
  }

  function teardownListeners() {
    if (ordersPollTimer) clearInterval(ordersPollTimer);
    if (messagesPollTimer) clearInterval(messagesPollTimer);
    ordersPollTimer = null;
    messagesPollTimer = null;
  }

  function getFilteredOrders() {
    const qStatus = $("filter-status").value;
    const qType = $("filter-type").value;
    const qSearch = ($("search-orders").value || "").trim().toLowerCase();

    return rawOrders.filter(({ id, data }) => {
      const st = normalizeStatus(data.status);
      if (qStatus && st !== qStatus) return false;
      if (qType && data.type !== qType) return false;
      if (qSearch) {
        const phone = (data.customer && data.customer.phone) || "";
        const name = (data.customer && data.customer.name) || "";
        const hay = (id + " " + name + " " + phone).toLowerCase();
        if (!hay.includes(qSearch)) return false;
      }
      return true;
    });
  }

  function renderStats() {
    const row = $("stats-row");
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCount = rawOrders.filter(({ data }) => {
      const d = data.createdAt ? new Date(data.createdAt) : null;
      return d && !Number.isNaN(d.getTime()) && d >= today;
    }).length;

    const activeKitchen = rawOrders.filter(({ data }) => {
      const st = normalizeStatus(data.status);
      return st === "confirmed" || st === "preparing";
    }).length;

    const ready = rawOrders.filter(({ data }) => normalizeStatus(data.status) === "ready").length;

    const newCount = rawOrders.filter(({ data }) => normalizeStatus(data.status) === "new").length;
    const needDecision = rawOrders.filter(
      ({ data }) => normalizeAcceptance(data.acceptance) === "pending",
    ).length;

    row.innerHTML = [
      { v: rawOrders.length, l: "All orders (loaded)" },
      { v: todayCount, l: "Placed today" },
      { v: needDecision, l: "Awaiting accept / decline" },
      { v: newCount, l: "New" },
      { v: activeKitchen, l: "In kitchen" },
      { v: ready, l: "Ready" },
    ]
      .map(
        (s) =>
          `<div class="stat-card"><div class="stat-value">${s.v}</div><div class="stat-label">${s.l}</div></div>`,
      )
      .join("");
  }

  function renderOrders() {
    const list = $("orders-list");
    const empty = $("orders-empty");
    const bulkOn = $("toggle-bulk").checked;
    const filtered = getFilteredOrders();

    $("orders-count").textContent =
      filtered.length === rawOrders.length
        ? `${filtered.length} order(s)`
        : `${filtered.length} shown (of ${rawOrders.length})`;

    if (filtered.length === 0) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    list.innerHTML = filtered
      .map(({ id, data }) => {
        const st = normalizeStatus(data.status);
        const acc = normalizeAcceptance(data.acceptance);
        const cust = data.customer || {};
        const total = (data.pricing && data.pricing.total) != null ? data.pricing.total : 0;
        const bulkCol = bulkOn
          ? `<div class="order-bulk"><input type="checkbox" class="order-check" data-id="${id}" ${
              selectedIds.has(id) ? "checked" : ""
            } /></div>`
          : "";

        const quickOpts = STATUSES.map(
          ({ value, label }) =>
            `<option value="${value}" ${value === st ? "selected" : ""}>${label}</option>`,
        ).join("");

        return `
        <article class="order-card ${bulkOn ? "bulk-on" : ""}" data-id="${id}">
          ${bulkCol}
          <div class="order-main">
            <div class="order-top">
              <span class="order-id">${id.slice(0, 8)}…</span>
              <span class="badge ${badgeClassForType(data.type)}">${data.type || "—"}</span>
              ${
                acc === "pending"
                  ? `<span class="badge badge-st-new">Needs decision</span>`
                  : ""
              }
              <span class="badge ${badgeClassForStatus(st)}">${statusLabel(st)}</span>
            </div>
            <div class="order-customer">${escapeHtml(cust.name || "—")}</div>
            <div class="order-meta-line">${escapeHtml(cust.phone || "")} · ${fmtDate(
          data.timestamp,
        )}</div>
            ${
              data.type === "Delivery" && data.address
                ? `<div class="order-meta-line">📍 ${escapeHtml(data.address)}</div>`
                : ""
            }
            <div class="order-items-preview">${escapeHtml(cartSummaryLines(data.cart))}</div>
          </div>
          <div class="order-side">
            <div class="order-total">${fmtMoney(total)}</div>
            <label class="quick-status muted">Quick status
              <select class="input-inline order-quick-status" data-id="${id}">${quickOpts}</select>
            </label>
            <div class="order-actions">
              <button type="button" class="btn btn-sm btn-secondary btn-open-drawer" data-id="${id}">Open / edit</button>
            </div>
          </div>
        </article>`;
      })
      .join("");

    list.querySelectorAll(".order-quick-status").forEach((sel) => {
      sel.addEventListener("change", () => quickStatusChange(sel.dataset.id, sel.value));
    });
    list.querySelectorAll(".btn-open-drawer").forEach((btn) => {
      btn.addEventListener("click", () => openDrawer(btn.dataset.id));
    });
    list.querySelectorAll(".order-check").forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.checked) selectedIds.add(cb.dataset.id);
        else selectedIds.delete(cb.dataset.id);
        updateBulkBar();
      });
    });
  }

  function escapeHtml(s) {
    if (!s) return "";
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  async function quickStatusChange(id, status) {
    try {
      const r = await apiFetch("/api/admin/orders/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify({ status: status }),
      });
      if (!r.ok) throw new Error("bad status");
    } catch (e) {
      console.error(e);
      alert("Could not update status. Check backend connection and login.");
    }
  }

  function updateBulkBar() {
    const bar = $("bulk-bar");
    const n = selectedIds.size;
    $("bulk-selected-count").textContent = String(n);
    bar.hidden = n === 0 && !$("toggle-bulk").checked;
    if (n > 0) bar.hidden = false;
    if (!$("toggle-bulk").checked && n === 0) bar.hidden = true;
  }

  $("toggle-bulk").addEventListener("change", () => {
    selectedIds.clear();
    updateBulkBar();
    renderOrders();
  });

  $("bulk-clear").addEventListener("click", () => {
    selectedIds.clear();
    updateBulkBar();
    renderOrders();
  });

  $("bulk-apply").addEventListener("click", async () => {
    const st = $("bulk-status").value;
    if (!st || selectedIds.size === 0) return;
    try {
      const ids = Array.from(selectedIds);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const r = await apiFetch("/api/admin/orders/" + encodeURIComponent(id), {
          method: "PATCH",
          body: JSON.stringify({ status: st }),
        });
        if (!r.ok) throw new Error("bulk");
      }
      selectedIds.clear();
      updateBulkBar();
    } catch (e) {
      console.error(e);
      alert("Bulk update failed. Check backend connection and login.");
    }
  });

  $("bulk-delete").addEventListener("click", async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Delete ${count} order(s) permanently?`)) return;
    try {
      const ids = Array.from(selectedIds);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const r = await apiFetch("/api/admin/orders/" + encodeURIComponent(id), { method: "DELETE" });
        if (!r.ok) throw new Error("bulkdel");
      }
      selectedIds.clear();
      updateBulkBar();
    } catch (e) {
      console.error(e);
      alert("Bulk delete failed. Check backend connection and login.");
    }
  });

  function openDrawer(id) {
    const doc = rawOrders.find((x) => x.id === id);
    if (!doc) return;
    const data = doc.data;

    $("edit-doc-id").value = id;
    $("drawer-title").textContent = "Order " + id.slice(0, 8) + "…";

    fillStatusSelect($("edit-status"), false);
    $("edit-status").value = normalizeStatus(data.status);

    $("edit-prep-notes").value = data.prepNotes || data.kitchenNotes || "";
    $("edit-name").value = (data.customer && data.customer.name) || "";
    $("edit-phone").value = (data.customer && data.customer.phone) || "";
    $("edit-type").value = data.type || "Pickup";
    $("edit-address").value = data.address || "";

    const etaEl = $("edit-eta");
    if (etaEl) {
      if (data.estimatedReadyAt) {
        const d = new Date(data.estimatedReadyAt);
        etaEl.value = Number.isNaN(d.getTime()) ? "" : dateToTimeValue(d);
      } else {
        etaEl.value = "";
      }
    }

    const riderLinkEl = $("rider-link");
    if (riderLinkEl) {
      const riderToken = data.riderToken || "";
      if (data.type === "Delivery" && riderToken) {
        riderLinkEl.value = `${location.origin}${location.pathname.replace(/admin\\.html?$/i, "")}rider.html?order=${encodeURIComponent(
          id,
        )}&token=${encodeURIComponent(riderToken)}`;
      } else if (data.type === "Delivery") {
        riderLinkEl.value = "Accept order to generate link…";
      } else {
        riderLinkEl.value = "Not a delivery order.";
      }
    }

    const accSec = $("acceptance-section");
    if (accSec) {
      accSec.hidden = normalizeAcceptance(data.acceptance) !== "pending";
    }

    const rider = data.rider || {};
    const rn = $("edit-rider-name");
    const rp = $("edit-rider-phone");
    if (rn) rn.value = rider.name || "";
    if (rp) rp.value = rider.phone || "";

    const prev = $("edit-cart-preview");
    if (Array.isArray(data.cart) && data.cart.length) {
      prev.innerHTML = data.cart
        .map((line) => {
          const addons = (line.addons || []).map((a) => `${a.label} (+${a.price || 0})`).join(", ");
          return `<div class="cart-line"><strong>${line.qty}× ${escapeHtml(line.name || "")}</strong>
            ${addons ? `<div class="muted">${escapeHtml(addons)}</div>` : ""}
            ${line.notes ? `<div class="muted">Note: ${escapeHtml(line.notes)}</div>` : ""}
            <div class="muted">${fmtMoney(line.lineTotal)}</div></div>`;
        })
        .join("");
    } else {
      prev.innerHTML = "<p class=\"muted\">No cart data</p>";
    }

    const p = data.pricing || {};
    $("edit-pricing").innerHTML = `
      Subtotal: ${fmtMoney(p.subtotal)}<br/>
      Delivery: ${fmtMoney(p.deliveryFee)}<br/>
      <strong>Total: ${fmtMoney(p.total)}</strong> ${p.currency || "GHS"}
    `;

    $("drawer-status").textContent = "";
    $("order-drawer").hidden = false;
    $("drawer-backdrop").hidden = false;
    $("order-drawer").setAttribute("aria-hidden", "false");
    updateFoodReadyUI();
  }

  function closeDrawer() {
    $("order-drawer").hidden = true;
    $("drawer-backdrop").hidden = true;
    $("order-drawer").setAttribute("aria-hidden", "true");
  }

  function updateFoodReadyUI() {
    const st = $("edit-status").value;
    const prompt = $("food-ready-prompt");
    const banner = $("food-ready-banner");
    const btnReady = $("btn-food-ready");
    const btnNot = $("btn-food-not-ready");
    if (!prompt || !banner) return;

    const row = rawOrders.find((x) => x.id === $("edit-doc-id").value);
    const acc = row ? normalizeAcceptance(row.data.acceptance) : "accepted";
    if (acc === "pending") {
      prompt.hidden = true;
      banner.hidden = true;
      banner.textContent = "";
      btnReady.disabled = true;
      btnNot.disabled = true;
      return;
    }

    if (st === "completed" || st === "cancelled") {
      prompt.hidden = true;
      banner.hidden = true;
      banner.textContent = "";
      btnReady.disabled = false;
      btnNot.disabled = false;
      return;
    }

    prompt.hidden = false;
    if (st === "ready") {
      banner.hidden = false;
      banner.textContent =
        "Food is ready — customer can pick up, dine in, or receive delivery.";
      btnReady.disabled = true;
      btnNot.disabled = false;
    } else {
      banner.hidden = true;
      banner.textContent = "";
      btnReady.disabled = false;
      btnNot.disabled = false;
    }
  }

  async function applyFoodReadyDecision(ready) {
    const id = $("edit-doc-id").value;
    if (!id) return;
    const row = rawOrders.find((x) => x.id === id);
    if (row && normalizeAcceptance(row.data.acceptance) === "pending") {
      $("drawer-status").textContent = "Accept the order first.";
      return;
    }
    const status = ready ? "ready" : "preparing";
    $("edit-status").value = status;
    $("drawer-status").textContent = "Saving…";
    try {
      const r = await apiFetch("/api/admin/orders/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify({ status: status }),
      });
      if (!r.ok) throw new Error("bad status");
      $("drawer-status").textContent = ready
        ? "Marked ready for customer."
        : "Marked as still preparing.";
      updateFoodReadyUI();
    } catch (e) {
      console.error(e);
      $("drawer-status").textContent = "Couldn't update status.";
    }
  }

  $("btn-food-ready").addEventListener("click", () => applyFoodReadyDecision(true));
  $("btn-food-not-ready").addEventListener("click", () => applyFoodReadyDecision(false));

  $("btn-accept-order").addEventListener("click", async () => {
    const id = $("edit-doc-id").value;
    if (!id) return;
    $("drawer-status").textContent = "Accepting…";
    try {
      const r = await apiFetch("/api/admin/orders/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify({ acceptance: "accepted", status: "confirmed" }),
      });
      if (!r.ok) throw new Error("bad status");
      const body = await r.json();
      const riderToken = body && body.order ? body.order.riderToken : "";
      $("drawer-status").textContent = "Order accepted.";
      const accSec = $("acceptance-section");
      if (accSec) accSec.hidden = true;
      fillStatusSelect($("edit-status"), false);
      $("edit-status").value = "confirmed";
      updateFoodReadyUI();

      const riderLinkEl = $("rider-link");
      if (riderLinkEl) {
        riderLinkEl.value = `${location.origin}${location.pathname.replace(/admin\\.html?$/i, "")}rider.html?order=${encodeURIComponent(
          id,
        )}&token=${encodeURIComponent(riderToken)}`;
      }
    } catch (e) {
      console.error(e);
      $("drawer-status").textContent = "Could not accept order.";
    }
  });

  $("btn-copy-rider-link").addEventListener("click", async () => {
    const el = $("rider-link");
    if (!el || !el.value) return;
    try {
      await navigator.clipboard.writeText(el.value);
      $("drawer-status").textContent = "Rider link copied.";
    } catch (e) {
      el.focus();
      el.select();
      document.execCommand("copy");
      $("drawer-status").textContent = "Rider link copied.";
    }
  });

  $("btn-regen-rider-link").addEventListener("click", async () => {
    const id = $("edit-doc-id").value;
    if (!id) return;
    if (
      !confirm(
        "Regenerate rider link? The old link will stop working immediately.",
      )
    )
      return;
    $("drawer-status").textContent = "Regenerating…";
    try {
      const r = await apiFetch("/api/admin/orders/" + encodeURIComponent(id) + "/regenerate-rider-token", {
        method: "POST",
      });
      if (!r.ok) throw new Error("bad status");
      const body = await r.json();
      const newToken = (body && body.riderToken) || "";

      const riderLinkEl = $("rider-link");
      if (riderLinkEl) {
        riderLinkEl.value = `${location.origin}${location.pathname.replace(/admin\\.html?$/i, "")}rider.html?order=${encodeURIComponent(
          id,
        )}&token=${encodeURIComponent(newToken)}`;
      }
      $("drawer-status").textContent = "New rider link generated.";
    } catch (e) {
      console.error(e);
      $("drawer-status").textContent = "Could not regenerate link.";
    }
  });

  $("btn-decline-order").addEventListener("click", async () => {
    const id = $("edit-doc-id").value;
    if (!id) return;
    if (!confirm("Decline this order? The customer will see that it could not be completed.")) return;
    $("drawer-status").textContent = "Declining…";
    try {
      const r = await apiFetch("/api/admin/orders/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify({ acceptance: "declined", status: "cancelled" }),
      });
      if (!r.ok) throw new Error("bad status");
      closeDrawer();
    } catch (e) {
      console.error(e);
      $("drawer-status").textContent = "Could not decline order.";
    }
  });

  $("drawer-close").addEventListener("click", closeDrawer);
  $("drawer-backdrop").addEventListener("click", closeDrawer);

  $("btn-save-order").addEventListener("click", async () => {
    const id = $("edit-doc-id").value;
    if (!id) return;
    $("drawer-status").textContent = "Saving…";
    try {
      const etaInput = ($("edit-eta") && $("edit-eta").value) || "";
      const payload = {
        status: $("edit-status").value,
        prepNotes: $("edit-prep-notes").value.trim(),
        customer: {
          name: $("edit-name").value.trim(),
          phone: $("edit-phone").value.trim(),
        },
        rider: {
          name: ($("edit-rider-name") && $("edit-rider-name").value.trim()) || "",
          phone: ($("edit-rider-phone") && $("edit-rider-phone").value.trim()) || "",
        },
        type: $("edit-type").value,
        address: $("edit-type").value === "Delivery" ? $("edit-address").value.trim() : null,
      };
      if (etaInput.trim()) {
        const d = timeValueToNextDate(etaInput.trim());
        if (d) payload.estimatedReadyAt = d.toISOString();
      } else {
        payload.estimatedReadyAt = null;
      }
      const r = await apiFetch("/api/admin/orders/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("bad status");
      $("drawer-status").textContent = "Saved.";
      updateFoodReadyUI();
    } catch (e) {
      console.error(e);
      $("drawer-status").textContent = "Error saving.";
    }
  });

  $("btn-delete-order").addEventListener("click", async () => {
    const id = $("edit-doc-id").value;
    if (!id) return;
    if (!confirm("Delete this order permanently?")) return;
    try {
      const r = await apiFetch("/api/admin/orders/" + encodeURIComponent(id), { method: "DELETE" });
      if (!r.ok) throw new Error("bad status");
      closeDrawer();
    } catch (e) {
      console.error(e);
      alert("Delete failed.");
    }
  });

  $("btn-print-ticket").addEventListener("click", () => {
    window.print();
  });

  function renderMessages() {
    const list = $("messages-list");
    const empty = $("messages-empty");
    if (rawMessages.length === 0) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = rawMessages
      .map(
        ({ id, data }) => `
      <article class="message-card" data-id="${id}">
        <h4>${escapeHtml(data.name || "—")}</h4>
        <div class="message-meta">${escapeHtml(data.email || "")} · ${fmtDate(data.createdAt)}</div>
        <p class="message-body">${escapeHtml(data.message || "")}</p>
        <div class="message-actions">
          <button type="button" class="btn btn-sm btn-danger btn-del-msg" data-id="${id}">Delete</button>
        </div>
      </article>`,
      )
      .join("");

    list.querySelectorAll(".btn-del-msg").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this message?")) return;
        try {
          const r = await apiFetch("/api/admin/contact-messages/" + encodeURIComponent(btn.dataset.id), {
            method: "DELETE",
          });
          if (!r.ok) throw new Error("bad status");
          await refreshMessagesOnce();
        } catch (e) {
          console.error(e);
          alert("Could not delete.");
        }
      });
    });
  }

  function wireFilters() {
    ["filter-status", "filter-type", "search-orders"].forEach((id) => {
      $(id).addEventListener("input", renderOrders);
      $(id).addEventListener("change", renderOrders);
    });
  }

  function wireOrderCardOpen() {
    $("orders-list").addEventListener("click", (e) => {
      const card = e.target.closest(".order-card");
      if (!card) return;
      if (e.target.closest("input, select, button, label")) return;
      openDrawer(card.dataset.id);
    });
  }

  function wireNav() {
    document.querySelectorAll(".side-nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".side-nav-item").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        const v = btn.dataset.view;
        document.querySelectorAll(".view-panel").forEach((p) => p.classList.remove("is-visible"));
        $("view-" + v).classList.add("is-visible");
      });
    });
  }

  async function refreshOrdersOnce() {
    const status = $("filter-status").value;
    const type = $("filter-type").value;
    const q = ($("search-orders").value || "").trim();
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (type) qs.set("type", type);
    if (q) qs.set("q", q);

    const r = await apiFetch("/api/admin/orders" + (qs.toString() ? "?" + qs.toString() : ""), { method: "GET" });
    if (r.status === 401) throw new Error("unauthorized");
    if (!r.ok) throw new Error("orders");
    const body = await r.json();
    const orders = (body && body.orders) || [];

    const idsNow = new Set(orders.map((o) => String(o._id || "")));
    if (!ordersSoundInitialized) {
      ordersSoundInitialized = true;
      ordersSoundSeenIds = new Set(idsNow);
    } else {
      idsNow.forEach((id) => {
        if (id && !ordersSoundSeenIds.has(id)) playOrderSound();
      });
      ordersSoundSeenIds = new Set(idsNow);
    }

    rawOrders = orders.map((o) => ({ id: String(o._id), data: o }));
    renderStats();
    renderOrders();
  }

  async function refreshMessagesOnce() {
    const r = await apiFetch("/api/admin/contact-messages", { method: "GET" });
    if (r.status === 401) throw new Error("unauthorized");
    if (!r.ok) throw new Error("messages");
    const body = await r.json();
    const msgs = (body && body.messages) || [];
    rawMessages = msgs.map((m) => ({ id: String(m._id), data: m }));
    renderMessages();
  }

  function showApp() {
    $("login-screen").hidden = true;
    $("app").hidden = false;
    teardownListeners();
    ordersSoundInitialized = false;
    ordersSoundSeenIds = new Set();
    refreshOrdersOnce().catch(() => {});
    refreshMessagesOnce().catch(() => {});
    ordersPollTimer = setInterval(() => refreshOrdersOnce().catch(() => {}), 3000);
    messagesPollTimer = setInterval(() => refreshMessagesOnce().catch(() => {}), 5000);
  }

  function showLogin() {
    teardownListeners();
    closeDrawer();
    $("app").hidden = true;
    $("login-screen").hidden = false;
    rawOrders = [];
    rawMessages = [];
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-error").textContent = "";
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    try {
      const r = await fetch(API_BASE + "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password }),
      });
      if (!r.ok) throw new Error("Invalid credentials");
      const body = await r.json();
      if (!body || !body.token) throw new Error("Login failed");
      setAdminToken(body.token);
      showApp();
    } catch (err) {
      $("login-error").textContent = err.message || "Sign-in failed.";
      setAdminToken("");
      showLogin();
    }
  });

  $("btn-signout").addEventListener("click", () => {
    setAdminToken("");
    showLogin();
  });
  $("btn-refresh").addEventListener("click", () => {
    renderStats();
    renderOrders();
    renderMessages();
  });
  if (getAdminToken()) showApp();
  else showLogin();

  fillStatusSelect($("filter-status"), true);
  fillStatusSelect($("bulk-status"), false);
  const bulkSel = $("bulk-status");
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "Set status…";
  bulkSel.insertBefore(emptyOpt, bulkSel.firstChild);

  fillStatusSelect($("edit-status"), false);

  $("edit-status").addEventListener("change", updateFoodReadyUI);

  wireFilters();
  wireNav();
  wireOrderCardOpen();
  updateBulkBar();
})();
