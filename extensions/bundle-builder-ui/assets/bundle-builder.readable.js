"use strict";
(function () {
  // --- small helpers ---------------------------------------------------------

  const parseIntOrFallback = (value, fallback = 0) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  };

  const generateBundleId = () =>
    `bundle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const fetchWithTimeout = async (url, fetchOptions, timeoutMs = 5000) => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      return await fetch(url, { ...fetchOptions, signal: abortController.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const parseJsonOrFallback = (jsonString, fallbackValue) => {
    try {
      const parsed = JSON.parse(jsonString || "");
      return parsed == null ? fallbackValue : parsed;
    } catch (_err) {
      return fallbackValue;
    }
  };

  // Aggregate selected items by role => { [roleKey]: totalQuantity }
  const countSelectedByRole = (selectedMap) => {
    const roleCounts = {};
    selectedMap.forEach((item) => {
      const roleKey = item.role || "unknown";
      roleCounts[roleKey] = (roleCounts[roleKey] || 0) + item.quantity;
    });
    return roleCounts;
  };

  const setStatusText = (statusEl, text, isReady) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    if (isReady) statusEl.setAttribute("data-state", "ready");
    else statusEl.removeAttribute("data-state");
  };

  // --- main bundle-builder init ---------------------------------------------

  const initBundleBuilder = (rootEl) => {
    var cachedTiers, cachedCategories;

    // DOM refs
    const statusEl = rootEl.querySelector("[data-bundle-status]");
    const commitButton = rootEl.querySelector("[data-bundle-action='commit']");
    const toggleButtons = Array.from(rootEl.querySelectorAll("[data-action='toggle']"));
    const previewEl = rootEl.querySelector("[data-bundle-preview]");
    const bundleCountEl = rootEl.querySelector("[data-bundle-count]");
    const tiersListEl = rootEl.querySelector("[data-bundle-tiers]");
    const proxyWarningEl = rootEl.querySelector("[data-bundle-proxy-warning]");

    const pricingWrapEl = rootEl.querySelector("[data-bundle-pricing]");
    const basePriceEl = rootEl.querySelector("[data-bundle-price-base]");
    const discountedPriceEl = rootEl.querySelector("[data-bundle-price-discounted]");
    const perUnitPriceEl = rootEl.querySelector("[data-bundle-price-per-unit]");

    // Copy / config from data-attrs
    const addText = rootEl.dataset.addText || "Add";
    const removeText = rootEl.dataset.removeText || "Remove";
    const parentVariantId = rootEl.dataset.parentVariantId;
    const currencyCode = rootEl.dataset.currencyCode || "USD";
    const bundleConfigId = rootEl.dataset.bundleConfigId || "";

    const rulebookStorageKey = `bundle_builder_rulebook_${bundleConfigId || "default"}`;

    const defaultStatusText = (statusEl?.textContent) || "";
    const readyStatusText = statusEl?.getAttribute("data-ready-text") || "";
    const invalidStatusText = statusEl?.getAttribute("data-invalid-text") || "";

    // selection state: Map<variantId, { role, quantity, image }>
    const selectedVariants = new Map();
    let liveQuoteDebounceTimer = null;
    let liveQuoteRequestSeq = 0;

    // Categories: [{ key, label, min, max }]
    let categories = parseJsonOrFallback(rootEl.dataset.categories, []);
    if (!Array.isArray(categories) || !categories.length) {
      categories = [
        { key: "full", label: "Full", min: 1, max: 2 },
        { key: "small", label: "Small", min: 2, max: 4 },
      ];
    }

    // Tiers: [{ percent, requirements: { [roleKey]: {min,max} } }]
    let tiers = parseJsonOrFallback(tiersListEl?.dataset?.bundleTiers, []);

    // Load cached rulebook if needed
    if ((!Array.isArray(tiers) || !tiers.length) && window.localStorage) {
      const cached = parseJsonOrFallback(window.localStorage.getItem(rulebookStorageKey), null);
      cachedTiers = cached?.tiers;
      if (cachedTiers?.length) {
        tiers = cached.tiers;
        cachedCategories = cached?.categories;
        if (cachedCategories?.length) categories = cached.categories;
      }
    }

    // --- UI formatting -------------------------------------------------------

    const formatMoney = (cents) => {
      try {
        return new Intl.NumberFormat(void 0, {
          style: "currency",
          currency: currencyCode,
        }).format((Number(cents) || 0) / 100);
      } catch {
        return `${((Number(cents) || 0) / 100).toFixed(2)} ${currencyCode}`;
      }
    };

    const renderPricing = (pricingResponse) => {
      if (!pricingWrapEl || !basePriceEl || !discountedPriceEl || !perUnitPriceEl) return;

      if (!pricingResponse) {
        pricingWrapEl.hidden = true;
        basePriceEl.textContent = "--";
        discountedPriceEl.textContent = "--";
        perUnitPriceEl.textContent = "--";
        return;
      }

      const baseCents = Math.max(0, parseIntOrFallback(pricingResponse.compareAtCents, 0));
      const discountedCents = Math.max(
        0,
        parseIntOrFallback(pricingResponse.discountedCents, 0)
      );

      const totalUnits = Array.isArray(pricingResponse.components)
        ? pricingResponse.components.reduce(
            (sum, component) =>
              sum + Math.max(1, parseIntOrFallback(component.quantity, 1)),
            0
          )
        : 0;

      const perUnitCents = totalUnits > 0 ? Math.round(discountedCents / totalUnits) : 0;

      pricingWrapEl.hidden = false;
      basePriceEl.textContent = formatMoney(baseCents);
      discountedPriceEl.textContent = formatMoney(discountedCents);
      perUnitPriceEl.textContent = formatMoney(perUnitCents);
    };

    const getVariantNumericId = (value) => {
      const str = String(value || "").trim();
      if (!str) return "";
      if (/^\d+$/.test(str)) return str;
      const match = str.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
      return match ? match[1] : "";
    };

    const buildQuotedComponentMap = (pricingResponse) => {
      const map = new Map();
      if (!Array.isArray(pricingResponse?.components)) return map;
      pricingResponse.components.forEach((component) => {
        const gid = String(component?.id || "");
        if (!gid) return;
        map.set(gid, component);
        const numeric = getVariantNumericId(gid);
        if (numeric) map.set(numeric, component);
      });
      return map;
    };

    const renderItemPricing = (pricingResponse) => {
      const itemEls = Array.from(rootEl.querySelectorAll(".bundle-builder__item"));
      const quotedMap = buildQuotedComponentMap(pricingResponse);
      const baseCents = Math.max(0, parseIntOrFallback(pricingResponse?.compareAtCents, 0));
      const discountedCents = Math.max(
        0,
        parseIntOrFallback(pricingResponse?.discountedCents, 0)
      );
      const ratio = baseCents > 0 ? discountedCents / baseCents : 1;

      itemEls.forEach((itemEl) => {
        const variantId = itemEl.getAttribute("data-variant-id") || "";
        const currentEl = itemEl.querySelector("[data-item-price-current]");
        const compareEl = itemEl.querySelector("[data-item-price-compare]");
        if (!currentEl || !compareEl || !variantId) return;

        const defaultSaleCents = Math.max(
          0,
          parseIntOrFallback(itemEl.getAttribute("data-price-cents"), 0)
        );
        const defaultCompareCents = Math.max(
          0,
          parseIntOrFallback(itemEl.getAttribute("data-compare-at-cents"), 0)
        );

        const selected = selectedVariants.has(variantId);
        const quoted = selected ? quotedMap.get(variantId) : null;

        if (!quoted) {
          // Initial card state rule:
          // - if compare-at exists, it is the visible base price
          // - no strike-through until a bundle discount is applied
          const initialBaseCents = defaultCompareCents > 0 ? defaultCompareCents : defaultSaleCents;
          currentEl.textContent = formatMoney(initialBaseCents);
          compareEl.hidden = true;
          compareEl.textContent = "";
          return;
        }

        const quotedBasisCents = Math.max(0, parseIntOrFallback(quoted?.unitCents, 0));
        const quotedCompareAtCents = Math.max(
          0,
          parseIntOrFallback(quoted?.compareAtUnitCents, 0)
        );
        const discountedUnitCents = Math.max(0, Math.round(quotedBasisCents * ratio));
        const strikeCents = quotedCompareAtCents > 0 ? quotedCompareAtCents : quotedBasisCents;

        currentEl.textContent = formatMoney(discountedUnitCents);
        if (strikeCents > discountedUnitCents) {
          compareEl.hidden = false;
          compareEl.textContent = formatMoney(strikeCents);
        } else {
          compareEl.hidden = true;
          compareEl.textContent = "";
        }
      });
    };

    const setProxyWarning = (message) => {
      if (!proxyWarningEl) return;
      if (!message) {
        proxyWarningEl.hidden = true;
        proxyWarningEl.textContent = "";
        return;
      }
      proxyWarningEl.textContent = message;
      proxyWarningEl.hidden = false;
    };

    // --- proxy path helpers --------------------------------------------------

    const getProxyPath = () => {
      if (rootEl.dataset.proxyPath) return rootEl.dataset.proxyPath;

      const stored = window.localStorage?.getItem("bundle_builder_proxy_path");
      if (stored) {
        rootEl.dataset.proxyPath = stored;
        return stored;
      }
      return "/apps/bundle-builder-1";
    };

    const persistProxyPath = (pathPrefix) => {
      if (!pathPrefix) return;
      rootEl.dataset.proxyPath = pathPrefix;
      window.localStorage?.setItem("bundle_builder_proxy_path", pathPrefix);
    };

    // --- selection / validation ---------------------------------------------

    // Valid means every category satisfies its min/max constraints
    // against the current selectedVariants map.
    const isSelectionValid = () => {
      const counts = countSelectedByRole(selectedVariants);
      return categories.every((cat) => {
        const count = counts[cat.key] || 0;
        const min = parseIntOrFallback(cat.min, 0);
        const max = cat.max === null || cat.max === "" ? null : parseIntOrFallback(cat.max, 0);
        return !(count < min || (max != null && count > max));
      });
    };

    const setItemSelectedUI = (itemEl, isSelected) => {
      const toggleBtn = itemEl.querySelector("[data-action='toggle']");
      if (!toggleBtn) return;

      toggleBtn.textContent = isSelected ? removeText : addText;
      if (isSelected) toggleBtn.setAttribute("data-selected", "true");
      else toggleBtn.removeAttribute("data-selected");
    };

    // Re-render preview from scratch so UI always reflects map state
    // (avoid stale DOM from partial updates).
    const renderPreview = () => {
      if (!previewEl) return;
      previewEl.innerHTML = "";

      const selectedEntries = Array.from(selectedVariants.entries());
      const totalSelected = selectedEntries.reduce((sum, [, item]) => sum + item.quantity, 0);

      if (bundleCountEl) bundleCountEl.textContent = String(totalSelected);

      selectedEntries.forEach(([, item]) => {
        const tileEl = document.createElement("div");
        tileEl.className = "bundle-builder__preview-tile";

        const imgEl = document.createElement("img");
        imgEl.alt = "";
        imgEl.loading = "lazy";
        imgEl.src = item.image || "";

        tileEl.appendChild(imgEl);
        previewEl.appendChild(tileEl);
      });
    };

    // Find the highest matching tier for the current selection
    // and mark it active in the offers list.
    const updateActiveTier = () => {
      const tierEls = Array.from(tiersListEl?.querySelectorAll("[data-tier]") || []);
      if (!tierEls.length || !tiers.length) return;

      tierEls.forEach((el) => el.removeAttribute("data-active"));

      const counts = countSelectedByRole(selectedVariants);

      const bestTier = tiers
        .filter((tier) => {
          const requirements = tier?.requirements || {};
          return Object.entries(requirements).every(([roleKey, req]) => {
            const count = counts[roleKey] || 0;
            const min = parseIntOrFallback(req?.min, 0);
            const max = req?.max === null || req?.max === "" ? null : parseIntOrFallback(req?.max, 0);
            return !(count < min || (max != null && count > max));
          });
        })
        .reduce((best, tier) => {
          if (!best) return tier;
          return parseIntOrFallback(tier.percent, 0) > parseIntOrFallback(best.percent, 0)
            ? tier
            : best;
        }, null);

      if (!bestTier) return;

      const activeEl = tierEls.find(
        (el) => el.getAttribute("data-tier") === String(bestTier.percent)
      );
      activeEl && activeEl.setAttribute("data-active", "true");
    };

    // Render the offers panel from rulebook data returned by proxy config.
    // We normalize by sorting on percent so display order is stable.
    const renderTiers = (nextTiers, nextCategories) => {
      if (!tiersListEl) return;

      const categoriesToUse =
        Array.isArray(nextCategories) && nextCategories.length ? nextCategories : categories;

      categories = categoriesToUse;
      tiersListEl.innerHTML = "";

      if (!Array.isArray(nextTiers) || !nextTiers.length) {
        const li = document.createElement("li");
        li.textContent = "No offers configured yet.";
        tiersListEl.appendChild(li);
        tiersListEl.dataset.bundleTiers = "[]";
        tiers = [];
        return;
      }

      const sorted = [...nextTiers].sort(
        (a, b) => parseIntOrFallback(a?.percent, 0) - parseIntOrFallback(b?.percent, 0)
      );

      sorted.forEach((tier) => {
        const li = document.createElement("li");
        li.setAttribute("data-tier", String(tier.percent));

        const requirementText = categoriesToUse.map((cat) => {
          const req = tier?.requirements?.[cat.key] || {};
          const min = parseIntOrFallback(req?.min, 0);
          const max = req?.max === null || req?.max === "" ? null : parseIntOrFallback(req?.max, 0);
          return max != null ? `${min}-${max} ${cat.label}` : `${min} ${cat.label}`;
        });

        li.textContent = `Pick ${requirementText.join(" & ")} -> ${tier.percent}% off`;
        tiersListEl.appendChild(li);
      });

      tiersListEl.dataset.bundleTiers = JSON.stringify(sorted);
      tiers = sorted;
      updateActiveTier();
    };

    // Central UI refresh: status pill, CTA enabled state, preview, active tier.
    // Call this after any selection mutation.
    const refreshUI = () => {
      const hasSelection = selectedVariants.size > 0;
      const valid = hasSelection && isSelectionValid();

      if (!hasSelection) setStatusText(statusEl, defaultStatusText, false);
      else if (valid) setStatusText(statusEl, readyStatusText, true);
      else setStatusText(statusEl, invalidStatusText, false);

      if (commitButton) commitButton.disabled = !valid;

      renderPreview();
      updateActiveTier();
      queueLiveQuote();
    };

    // Full reset after successful add-to-cart.
    // We also clear pricing summary so the next bundle starts clean.
    const resetSelection = () => {
      selectedVariants.clear();

      toggleButtons.forEach((btn) => {
        const itemEl = btn.closest(".bundle-builder__item");
        if (itemEl) setItemSelectedUI(itemEl, false);
      });

      renderPricing(null);
      renderItemPricing(null);
      refreshUI();
    };

    // Toggle one card in or out of selectedVariants with max-per-role guard.
    const toggleSelectionForItem = (itemEl) => {
      const variantId = itemEl.getAttribute("data-variant-id");
      const roleKey = itemEl.getAttribute("data-role");
      const imageUrl = itemEl.querySelector(".bundle-builder__item-image")?.getAttribute("src");

      if (!variantId || !roleKey) return;

      // remove
      if (selectedVariants.has(variantId)) {
        selectedVariants.delete(variantId);
        setItemSelectedUI(itemEl, false);
        refreshUI();
        return;
      }

      // enforce per-role max
      const category = categories.find((cat) => cat.key === roleKey);
      if (category) {
        const counts = countSelectedByRole(selectedVariants);
        const max = category.max === null || category.max === "" ? null : parseIntOrFallback(category.max, 0);
        if (max != null && (counts[roleKey] || 0) + 1 > max) return;
      }

      // add
      selectedVariants.set(variantId, { role: roleKey, quantity: 1, image: imageUrl });
      setItemSelectedUI(itemEl, true);
      refreshUI();
    };

    // --- networking ----------------------------------------------------------

    // Fetches server-authoritative rulebook config used for offer rendering.
    // Retries are intentionally long on first attempt to tolerate cold starts.
    const fetchRulebookIfNeeded = async () => {
      if (!tiersListEl) return false;

      const proxyPath = getProxyPath();
      const url = `${proxyPath}/price?config=1&rulebookId=${encodeURIComponent(bundleConfigId || "")}`;
      const attemptTimeouts = [12000, 8000, 8000];

      for (let attempt = 0; attempt < attemptTimeouts.length; attempt += 1) {
        try {
          const resp = await fetchWithTimeout(
            url,
            { method: "GET", headers: { Accept: "application/json" } },
            attemptTimeouts[attempt]
          );

          if (!resp.ok) {
            if (attempt === attemptTimeouts.length - 1) {
              setProxyWarning("Bundle offers are unavailable right now. Refresh in a moment.");
            }
            continue;
          }

          const json = await resp.json();
          const rulebook = json?.rulebook;

          if (!rulebook) {
            if (attempt === attemptTimeouts.length - 1) {
              setProxyWarning("Bundle offers are unavailable right now. Refresh in a moment.");
            }
            continue;
          }

          // Cache config so storefront can still render offers even if
          // proxy is temporarily unavailable on later page loads.
          if (window.localStorage) {
            window.localStorage.setItem(
              rulebookStorageKey,
              JSON.stringify({
                categories: rulebook.categories || [],
                tiers: rulebook.tiers || [],
              })
            );
          }

          setProxyWarning("");
          renderTiers(rulebook.tiers || [], rulebook.categories || []);
          return true;
        } catch (_err) {
          if (attempt === attemptTimeouts.length - 1) {
            setProxyWarning("Bundle offers are unavailable right now. Refresh in a moment.");
            return false;
          }
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }

      return false;
    };

    // Quote endpoint computes:
    // - canonical component pricing
    // - tier match
    // - discountedCents
    // - signature for transform verification
    const requestBundlePricing = async (bundleId, components) => {
      try {
        const resp = await fetchWithTimeout(
          `${getProxyPath()}/price`,
          {
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
          },
          8000
        );

        if (resp.status === 404) {
          setProxyWarning("Bundle pricing is unavailable. Check the app proxy path.");
          return null;
        }
        if (!resp.ok) {
          setProxyWarning("Bundle pricing failed. Please try again.");
          return null;
        }

        setProxyWarning("");

        const json = await resp.json();
        // pathPrefix is returned by Shopify proxy flow and may differ per shop.
        if (json?.pathPrefix) persistProxyPath(json.pathPrefix);
        // If initial config retries failed during cold start, try again now that
        // pricing succeeded and the app proxy/backend are clearly reachable.
        if ((!Array.isArray(tiers) || !tiers.length) && tiersListEl) {
          fetchRulebookIfNeeded().catch(() => {});
        }
        return json;
      } catch (_err) {
        setProxyWarning("Bundle pricing is unavailable. Check the app proxy path.");
        return null;
      }
    };

    const queueLiveQuote = () => {
      if (liveQuoteDebounceTimer) clearTimeout(liveQuoteDebounceTimer);

      if (!isSelectionValid() || selectedVariants.size === 0) {
        liveQuoteRequestSeq += 1;
        renderPricing(null);
        renderItemPricing(null);
        return;
      }

      liveQuoteDebounceTimer = setTimeout(async () => {
        const requestSeq = ++liveQuoteRequestSeq;
        const bundleId = generateBundleId();
        const components = Array.from(selectedVariants.entries()).map(([variantId, item]) => ({
          id: String(variantId),
          quantity: item.quantity,
          role: item.role,
        }));
        const pricing = await requestBundlePricing(bundleId, components);
        if (requestSeq !== liveQuoteRequestSeq) return;
        if (pricing) {
          renderPricing(pricing);
          renderItemPricing(pricing);
        }
      }, 400);
    };

    // --- tier retry loop -----------------------------------------------------

    let shouldFetchRulebook = !tiers.length;
    let rulebookRetryCount = 0;

    // Background retry loop used only when tier config isn't available yet.
    // Keeps trying a limited number of times, then stops quietly.
    const retryFetchRulebook = async () => {
      if (!shouldFetchRulebook) return;

      const ok = await fetchRulebookIfNeeded();
      if (ok) {
        shouldFetchRulebook = false;
        return;
      }

      rulebookRetryCount += 1;
      if (rulebookRetryCount < 10) setTimeout(retryFetchRulebook, 3000);
    };

    // --- event wiring --------------------------------------------------------

    toggleButtons.forEach((btn) => {
      const itemEl = btn.closest(".bundle-builder__item");
      if (!itemEl) return;
      btn.addEventListener("click", () => toggleSelectionForItem(itemEl));
    });

    // Always try to hydrate offers from proxy config so stale/empty Liquid data
    // gets corrected even when cached tiers or initial markup are present.
    // Keep retry loop only for empty initial state where cold starts are common.
    fetchRulebookIfNeeded().catch(() => {});
    if (!tiers.length) retryFetchRulebook();

    // Commit sequence:
    // 1) validate selection
    // 2) request pricing quote
    // 3) call add-bundle proxy (server signs + posts to cart/add.js)
    // 4) emit cart:update so theme/cart drawer can refresh
    commitButton?.addEventListener("click", async () => {
      if (!isSelectionValid() || selectedVariants.size === 0) {
        refreshUI();
        return;
      }
      if (!parentVariantId) return;

      const bundleId = generateBundleId();
      const components = Array.from(selectedVariants.entries()).map(([variantId, item]) => ({
        id: String(variantId),
        quantity: item.quantity,
        role: item.role,
      }));

      // Pricing call is primarily for UX preview and consistency.
      // add-bundle still recomputes server-side authoritatively.
      const pricing = await requestBundlePricing(bundleId, components);
      if (!pricing) setStatusText(statusEl, "Pricing unavailable. Adding bundle anyway.", false);

      renderPricing(pricing);
      commitButton.disabled = true;

      const cartCookieMatch = document.cookie.match(/(?:^|; )cart=([^;]+)/);
      const cartToken = cartCookieMatch ? cartCookieMatch[1] : "";

      try {
        // Add through app proxy rather than direct /cart/add.js from browser,
        // so signature + protected bundle properties are server-controlled.
        const resp = await fetchWithTimeout(
          `${getProxyPath()}/add-bundle`,
          {
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
          },
          12000
        );

        if (!resp.ok) {
          setStatusText(statusEl, "Unable to add bundle. Please try again.", false);
          commitButton.disabled = false;
          return;
        }

        const payload = await resp.json().catch(() => null);
        const cart = payload?.cart || null;

        if (payload?.cartToken) {
          document.cookie = `cart=${payload.cartToken}; path=/; SameSite=Lax`;
        }

        // Trigger theme listeners (drawer, mini cart, etc.) to refresh.
        document.dispatchEvent(
          new CustomEvent("cart:update", {
            bubbles: true,
            detail: {
              resource: cart,
              sourceId: "bundle-builder",
              data: {
                source: "bundle-builder",
                itemCount: cart?.item_count,
              },
            },
          })
        );

        resetSelection();
      } catch (_err) {
        commitButton.disabled = false;
      }
    });

    // initial UI
    renderItemPricing(null);
    refreshUI();
  };

  const initAllBundleBuilders = () => {
    document.querySelectorAll(".bundle-builder").forEach(initBundleBuilder);
  };

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", initAllBundleBuilders)
    : initAllBundleBuilders();
})();
