(function () {
  const toInt = (value, fallback) => {
    const num = Number.parseInt(value, 10);
    return Number.isNaN(num) ? fallback : num;
  };

  const createBundleId = () =>
    `bundle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const getCounts = (queue) => {
    const counts = {};
    queue.forEach((item) => {
      const role = item.role || "unknown";
      counts[role] = (counts[role] || 0) + item.quantity;
    });
    return counts;
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
    const tiersList = root.querySelector("[data-bundle-tiers]");
    let tiers = [];
    try {
      tiers = JSON.parse(tiersList?.dataset?.bundleTiers || "[]");
    } catch {
      tiers = [];
    }
    let categories = [];
    try {
      categories = JSON.parse(root.dataset.categories || "[]");
    } catch {
      categories = [];
    }
    if (!Array.isArray(categories) || !categories.length) {
      categories = [
        { key: "full", min: 1, max: 2 },
        { key: "small", min: 2, max: 4 },
      ];
    }
    const addText = root.dataset.addText || "Add";
    const removeText = root.dataset.removeText || "Remove";
    const parentVariantId = root.dataset.parentVariantId;
    const bundleConfigId = root.dataset.bundleConfigId || "";
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
      const rows = Array.from(tiersList?.querySelectorAll("[data-tier]") || []);
      if (!rows.length) return;
      rows.forEach((row) => row.removeAttribute("data-active"));
      if (!tiers.length) return;

      const counts = getCounts(queue);
      const matches = tiers.filter((tier) => {
        const requirements = tier?.requirements || {};
        return Object.entries(requirements).every(([key, req]) => {
          const count = counts[key] || 0;
          const min = toInt(req?.min, 0);
          const max =
            req?.max === null || req?.max === ""
              ? null
              : toInt(req?.max, 0);
          if (count < min) return false;
          if (max != null && count > max) return false;
          return true;
        });
      });

      const active = matches.reduce((best, tier) => {
        if (!best) return tier;
        return toInt(tier.percent, 0) > toInt(best.percent, 0) ? tier : best;
      }, null);

      if (!active) return;
      const activeRow = rows.find(
        (row) => row.getAttribute("data-tier") === String(active.percent),
      );
      if (activeRow) {
        activeRow.setAttribute("data-active", "true");
      }
    };

    const renderOffers = (nextTiers, nextCategories) => {
      if (!tiersList) return;
      tiersList.innerHTML = "";
      if (!Array.isArray(nextTiers) || nextTiers.length === 0) {
        const li = document.createElement("li");
        li.textContent = "No offers configured yet.";
        tiersList.appendChild(li);
        tiersList.dataset.bundleTiers = "[]";
        tiers = [];
        return;
      }

      const categoriesForOffers =
        Array.isArray(nextCategories) && nextCategories.length
          ? nextCategories
          : categories;

      const sortedTiers = [...nextTiers].sort(
        (a, b) => toInt(b?.percent, 0) - toInt(a?.percent, 0),
      );
      sortedTiers.forEach((tier) => {
        const li = document.createElement("li");
        li.setAttribute("data-tier", String(tier.percent));
        const parts = categoriesForOffers.map((category) => {
          const req = tier?.requirements?.[category.key] || {};
          const min = toInt(req?.min, 0);
          const max =
            req?.max === null || req?.max === ""
              ? null
              : toInt(req?.max, 0);
          if (max != null) return `${min}-${max} ${category.label}`;
          return `${min} ${category.label}`;
        });
        li.textContent = `Pick ${parts.join(" & ")} → ${tier.percent}% off`;
        tiersList.appendChild(li);
      });

      tiersList.dataset.bundleTiers = JSON.stringify(sortedTiers);
      tiers = sortedTiers;
      updateTierHighlight();
    };

    const refreshStatus = () => {
      const counts = getCounts(queue);
      const hasSelection = queue.size > 0;
      const valid = categories.every((category) => {
        const count = counts[category.key] || 0;
        const min = toInt(category.min, 0);
        const max =
          category.max === null || category.max === ""
            ? null
            : toInt(category.max, 0);
        if (count < min) return false;
        if (max != null && count > max) return false;
        return true;
      });

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

    const resetSelection = () => {
      queue.clear();
      toggles.forEach((button) => {
        const item = button.closest(".bundle-builder__item");
        if (item) setToggleState(item, false);
      });
      refreshStatus();
      if (commitButton) {
        commitButton.disabled = true;
      }
    };

    const toggleItem = (item) => {
      const variantId = item.getAttribute("data-variant-id");
      const role = item.getAttribute("data-role");
      const image = item.querySelector(".bundle-builder__item-image")?.getAttribute("src");
      if (!variantId || !role) return;

      const existing = queue.get(variantId);
      if (existing) {
        queue.delete(variantId);
        setToggleState(item, false);
        refreshStatus();
        return;
      }

      const counts = getCounts(queue);
      const category = categories.find((entry) => entry.key === role);
      if (category) {
        const max =
          category.max === null || category.max === ""
            ? null
            : toInt(category.max, 0);
        if (max != null && (counts[role] || 0) + 1 > max) {
          return;
        }
      }

      queue.set(variantId, { role, quantity: 1, image });
      setToggleState(item, true);
      refreshStatus();
    };

    const setProxyWarning = (message) => {
      const warning = root.querySelector("[data-bundle-proxy-warning]");
      if (!warning) return;
      if (message) {
        warning.textContent = message;
        warning.hidden = false;
      } else {
        warning.hidden = true;
        warning.textContent = "";
      }
    };

    const getProxyBase = () => {
      if (root.dataset.proxyPath) return root.dataset.proxyPath;
      const cached = window.localStorage?.getItem("bundle_builder_proxy_path");
      if (cached) {
        root.dataset.proxyPath = cached;
        return cached;
      }
      return "/apps/bundle-builder-1";
    };

    const cacheProxyPath = (pathPrefix) => {
      if (!pathPrefix) return;
      root.dataset.proxyPath = pathPrefix;
      window.localStorage?.setItem("bundle_builder_proxy_path", pathPrefix);
    };

    const fetchOfferConfig = async () => {
      if (!tiersList) return;
      if (tiers.length > 0) return;
      const proxyBase = getProxyBase();
      try {
        const response = await fetch(
          `${proxyBase}/price?config=1&rulebookId=${encodeURIComponent(
            bundleConfigId || "",
          )}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
          },
        );
        if (!response.ok) return;
        const data = await response.json();
        const rulebook = data?.rulebook;
        if (!rulebook) return;
        renderOffers(rulebook.tiers || [], rulebook.categories || []);
      } catch {
        // ignore
      }
    };

    toggles.forEach((button) => {
      const item = button.closest(".bundle-builder__item");
      if (!item) return;
      button.addEventListener("click", () => toggleItem(item));
    });

    fetchOfferConfig();

    const requestBundlePrice = async (bundleId, components) => {
      const proxyBase = getProxyBase();
      let response;
      try {
        response = await fetch(`${proxyBase}/price`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            bundleId,
            rulebookId: bundleConfigId,
            components,
          }),
        });
      } catch (error) {
        setProxyWarning("Bundle pricing is unavailable. Check the app proxy path.");
        return null;
      }
      if (response.status === 404) {
        setProxyWarning("Bundle pricing is unavailable. Check the app proxy path.");
        return null;
      }
      if (!response.ok) {
        setProxyWarning("Bundle pricing failed. Please try again.");
        return null;
      }
      setProxyWarning("");
      const data = await response.json();
      if (data?.pathPrefix) {
        cacheProxyPath(data.pathPrefix);
      }
      return data;
    };

    if (commitButton) {
      commitButton.addEventListener("click", async () => {
        const counts = getCounts(queue);
        const valid = categories.every((category) => {
          const count = counts[category.key] || 0;
          const min = toInt(category.min, 0);
          const max =
            category.max === null || category.max === ""
              ? null
              : toInt(category.max, 0);
          if (count < min) return false;
          if (max != null && count > max) return false;
          return true;
        });
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
          }),
        );

        const pricing = await requestBundlePrice(bundleId, components);
        if (!pricing) {
          setStatusText(statusEl, "Pricing unavailable. Adding bundle anyway.", false);
        }

        commitButton.disabled = true;

        const cartTokenMatch = document.cookie.match(/(?:^|; )cart=([^;]+)/);
        const cartToken = cartTokenMatch ? cartTokenMatch[1] : "";

        try {
          const response = await fetch(`${getProxyBase()}/add-bundle`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            credentials: "same-origin",
            body: JSON.stringify({
              bundleId,
              rulebookId: bundleConfigId,
              parentVariantId,
              components,
              cartToken,
            }),
          });

          if (!response.ok) {
            setStatusText(
              statusEl,
              "Unable to add bundle. Please try again.",
              false,
            );
            commitButton.disabled = false;
            return;
          }

          const payload = await response.json().catch(() => null);
          const cart = payload?.cart || null;
          if (payload?.cartToken) {
            document.cookie = `cart=${payload.cartToken}; path=/; SameSite=Lax`;
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

          resetSelection();
        } catch (error) {
          commitButton.disabled = false;
        }
      });
    }

    const autoSyncProxyPath = async () => {
      const proxyBase = getProxyBase();
      try {
        const response = await fetch(`${proxyBase}/price?ping=1`);
        if (!response.ok) return;
        const data = await response.json();
        if (data?.pathPrefix) {
          cacheProxyPath(data.pathPrefix);
        }
      } catch (error) {
        // silent, warning shown on action
      }
    };

    autoSyncProxyPath();

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
