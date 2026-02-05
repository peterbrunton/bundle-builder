(function () {
  const toInt = (value, fallback) => {
    const num = Number.parseInt(value, 10);
    return Number.isNaN(num) ? fallback : num;
  };

  const createBundleId = () =>
    `bundle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const getCounts = (queue) => {
    let full = 0;
    let small = 0;
    queue.forEach((item) => {
      if (item.role === "full") {
        full += item.quantity;
      } else {
        small += item.quantity;
      }
    });
    return { full, small };
  };

  const setStatusText = (statusEl, text, ready) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    if (ready) {
      statusEl.setAttribute("data-state", "ready");
    } else {
      statusEl.removeAttribute("data-state");
    }
  };

  const init = (root) => {
    const statusEl = root.querySelector("[data-bundle-status]");
    const commitButton = root.querySelector("[data-bundle-action='commit']");
    const toggles = Array.from(root.querySelectorAll("[data-action='toggle']"));
    const previewGrid = root.querySelector("[data-bundle-preview]");
    const previewCount = root.querySelector("[data-bundle-count]");
    const tierRows = Array.from(root.querySelectorAll("[data-tier]"));
    const minFull = toInt(root.dataset.minFull, 1);
    const maxFull = toInt(root.dataset.maxFull, 2);
    const minSmall = toInt(root.dataset.minSmall, 0);
    const maxSmall = toInt(root.dataset.maxSmall, 4);
    const addText = root.dataset.addText || "Add";
    const removeText = root.dataset.removeText || "Remove";
    const parentVariantId = root.dataset.parentVariantId;
    const idleText = statusEl?.textContent || "";
    const readyText = statusEl?.getAttribute("data-ready-text") || "";
    const invalidText = statusEl?.getAttribute("data-invalid-text") || "";
    const queue = new Map();

    const setToggleState = (item, active) => {
      const button = item.querySelector("[data-action='toggle']");
      if (!button) return;
      if (active) {
        button.textContent = removeText;
        button.setAttribute("data-selected", "true");
      } else {
        button.textContent = addText;
        button.removeAttribute("data-selected");
      }
    };

    const renderPreview = () => {
      if (!previewGrid) return;
      previewGrid.innerHTML = "";
      const items = Array.from(queue.entries());
      const totalCount = items.reduce((sum, [, item]) => sum + item.quantity, 0);
      if (previewCount) previewCount.textContent = String(totalCount);
      items.forEach(([variantId, item]) => {
        const tile = document.createElement("div");
        tile.className = "bundle-builder__preview-tile";
        const img = document.createElement("img");
        img.alt = "";
        img.loading = "lazy";
        img.src = item.image || "";
        tile.appendChild(img);
        previewGrid.appendChild(tile);
      });
    };

    const updateTierHighlight = () => {
      if (!tierRows.length) return;
      const { full, small } = getCounts(queue);
      let active = "";
      if (full >= 2 && small >= 4) active = "20";
      else if (full >= 1 && small >= 4) active = "15";
      else if (full >= 1 && small >= 2) active = "10";
      tierRows.forEach((row) => {
        if (row.getAttribute("data-tier") === active) {
          row.setAttribute("data-active", "true");
        } else {
          row.removeAttribute("data-active");
        }
      });
    };

    const refreshStatus = () => {
      const { full, small } = getCounts(queue);
      const hasSelection = queue.size > 0;
      const valid =
        full >= minFull &&
        full <= maxFull &&
        small >= minSmall &&
        small <= maxSmall;

      if (!hasSelection) {
        setStatusText(statusEl, idleText, false);
      } else if (valid) {
        setStatusText(statusEl, readyText, true);
      } else {
        setStatusText(statusEl, invalidText, false);
      }

      if (commitButton) {
        commitButton.disabled = !valid || !hasSelection;
      }

      renderPreview();
      updateTierHighlight();
    };

    const toggleItem = (item) => {
      const variantId = item.getAttribute("data-variant-id");
      const role = item.getAttribute("data-role");
      const price = item.getAttribute("data-price");
      const priceCents = item.getAttribute("data-price-cents");
      const image = item.querySelector(".bundle-builder__item-image")?.getAttribute("src");
      if (!variantId || !role) return;

      const existing = queue.get(variantId);
      if (existing) {
        queue.delete(variantId);
        setToggleState(item, false);
        refreshStatus();
        return;
      }

      const { full, small } = getCounts(queue);
      if (role === "full" && full + 1 > maxFull) {
        return;
      }
      if (role === "small" && small + 1 > maxSmall) {
        return;
      }

      queue.set(variantId, { role, quantity: 1, price, priceCents, image });
      setToggleState(item, true);
      refreshStatus();
    };

    toggles.forEach((button) => {
      const item = button.closest(".bundle-builder__item");
      if (!item) return;
      button.addEventListener("click", () => toggleItem(item));
    });

    if (commitButton) {
      commitButton.addEventListener("click", async () => {
        const { full, small } = getCounts(queue);
        const valid =
          full >= minFull &&
          full <= maxFull &&
          small >= minSmall &&
          small <= maxSmall;
        if (!valid || queue.size === 0) {
          refreshStatus();
          return;
        }
        if (!parentVariantId) {
          commitButton.disabled = false;
          return;
        }

        const bundleId = createBundleId();
        const components = Array.from(queue.entries()).map(
          ([variantId, item]) => ({
            id: String(variantId),
            quantity: item.quantity,
            role: item.role,
            price: item.price,
            priceCents: item.priceCents,
          }),
        );

        const tierRules = [
          { minFull: 2, minSmall: 4, percent: 20 },
          { minFull: 1, minSmall: 4, percent: 15 },
          { minFull: 1, minSmall: 2, percent: 10 },
        ];
        const rule = tierRules.find(
          (tier) => full >= tier.minFull && small >= tier.minSmall,
        );
        const discountLabel = rule ? `Bundle ${rule.percent}% off` : "";

        const baseTotalCents = components.reduce((sum, item) => {
          const cents = Number(item.priceCents) || 0;
          const qty = Number(item.quantity) || 1;
          return sum + cents * qty;
        }, 0);
        const discountedTotalCents = rule
          ? Math.max(
              0,
              Math.round(baseTotalCents * (1 - rule.percent / 100)),
            )
          : baseTotalCents;

        const items = [
          {
            id: parentVariantId,
            quantity: 1,
            properties: {
              _bundle_id: bundleId,
              _bundle_version: root.dataset.bundleVersion || "v1",
              _bundle_components: JSON.stringify(components),
              _bundle_discount_label: discountLabel,
              _bundle_compare_at_cents: String(baseTotalCents),
              _bundle_discounted_cents: String(discountedTotalCents),
            },
          },
        ];

        commitButton.disabled = true;

        try {
          const response = await fetch("/cart/add.js", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ items }),
          });

          if (!response.ok) {
            commitButton.disabled = false;
            return;
          }

          let cart = null;
          try {
            cart = await fetch("/cart.js", {
              headers: { Accept: "application/json" },
            }).then((res) => (res.ok ? res.json() : null));
          } catch (error) {
            cart = null;
          }

          const detail = {
            resource: cart,
            sourceId: "bundle-builder",
            data: {
              source: "bundle-builder",
              itemCount: cart?.item_count,
            },
          };

          document.dispatchEvent(
            new CustomEvent("cart:update", {
              bubbles: true,
              detail,
            }),
          );
        } catch (error) {
          commitButton.disabled = false;
        }
      });
    }

    refreshStatus();
  };

  const start = () => {
    document.querySelectorAll(".bundle-builder").forEach(init);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
