"use strict";
(function () {
  const s = (l, u = 0) => {
      const o = Number.parseInt(l, 10);
      return Number.isNaN(o) ? u : o;
    },
    D = () => `bundle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    q = async (l, u, o = 5e3) => {
      const h = new AbortController(),
        c = setTimeout(() => h.abort(), o);
      try {
        return await fetch(l, { ...u, signal: h.signal });
      } finally {
        clearTimeout(c);
      }
    },
    T = (l, u) => {
      try {
        const o = JSON.parse(l || "");
        return o == null ? u : o;
      } catch (o) {
        return u;
      }
    },
    E = (l) => {
      const u = {};
      return (
        l.forEach((o) => {
          const h = o.role || "unknown";
          u[h] = (u[h] || 0) + o.quantity;
        }),
        u
      );
    },
    x = (l, u, o) => {
      l &&
        ((l.textContent = u),
        o
          ? l.setAttribute("data-state", "ready")
          : l.removeAttribute("data-state"));
    },
    H = (l) => {
      var u, o, h;
      const c = l.querySelector("[data-bundle-status]"),
        v = l.querySelector("[data-bundle-action='commit']"),
        j = Array.from(l.querySelectorAll("[data-action='toggle']")),
        I = l.querySelector("[data-bundle-preview]"),
        O = l.querySelector("[data-bundle-count]"),
        b = l.querySelector("[data-bundle-tiers]"),
        A = l.querySelector("[data-bundle-proxy-warning]"),
        R = l.dataset.addText || "Add",
        U = l.dataset.removeText || "Remove",
        L = l.dataset.parentVariantId,
        C = l.dataset.bundleConfigId || "",
        J = `bundle_builder_rulebook_${C || "default"}`,
        V = (c == null ? void 0 : c.textContent) || "",
        F = (c == null ? void 0 : c.getAttribute("data-ready-text")) || "",
        G = (c == null ? void 0 : c.getAttribute("data-invalid-text")) || "",
        m = new Map();
      let f = T(l.dataset.categories, []);
      (!Array.isArray(f) || !f.length) &&
        (f = [
          { key: "full", label: "Full", min: 1, max: 2 },
          { key: "small", label: "Small", min: 2, max: 4 },
        ]);
      let g = T(
        (u = b == null ? void 0 : b.dataset) == null ? void 0 : u.bundleTiers,
        [],
      );
      if ((!Array.isArray(g) || !g.length) && window.localStorage) {
        const e = T(window.localStorage.getItem(J), null);
        (o = e == null ? void 0 : e.tiers) != null &&
          o.length &&
          ((g = e.tiers),
          (h = e.categories) != null && h.length && (f = e.categories));
      }
      const _ = (e) => {
          if (A) {
            if (!e) {
              ((A.hidden = !0), (A.textContent = ""));
              return;
            }
            ((A.textContent = e), (A.hidden = !1));
          }
        },
        $ = () => {
          var e;
          if (l.dataset.proxyPath) return l.dataset.proxyPath;
          const t =
            (e = window.localStorage) == null
              ? void 0
              : e.getItem("bundle_builder_proxy_path");
          return t ? ((l.dataset.proxyPath = t), t) : "/apps/bundle-builder-1";
        },
        K = (e) => {
          var t;
          e &&
            ((l.dataset.proxyPath = e),
            (t = window.localStorage) == null ||
              t.setItem("bundle_builder_proxy_path", e));
        },
        M = () => {
          const e = E(m);
          return f.every((t) => {
            const a = e[t.key] || 0,
              r = s(t.min, 0),
              n = t.max === null || t.max === "" ? null : s(t.max, 0);
            return !(a < r || (n != null && a > n));
          });
        },
        P = (e, t) => {
          const a = e.querySelector("[data-action='toggle']");
          a &&
            ((a.textContent = t ? U : R),
            t
              ? a.setAttribute("data-selected", "true")
              : a.removeAttribute("data-selected"));
        },
        Q = () => {
          if (!I) return;
          I.innerHTML = "";
          const e = Array.from(m.entries()),
            t = e.reduce((a, [, r]) => a + r.quantity, 0);
          (O && (O.textContent = String(t)),
            e.forEach(([, a]) => {
              const r = document.createElement("div");
              r.className = "bundle-builder__preview-tile";
              const n = document.createElement("img");
              ((n.alt = ""),
                (n.loading = "lazy"),
                (n.src = a.image || ""),
                r.appendChild(n),
                I.appendChild(r));
            }));
        },
        z = () => {
          const e = Array.from(
            (b == null ? void 0 : b.querySelectorAll("[data-tier]")) || [],
          );
          if (!e.length || !g.length) return;
          e.forEach((n) => n.removeAttribute("data-active"));
          const t = E(m),
            a = g
              .filter((n) => {
                const i = (n == null ? void 0 : n.requirements) || {};
                return Object.entries(i).every(([p, d]) => {
                  const w = t[p] || 0,
                    y = s(d == null ? void 0 : d.min, 0),
                    k =
                      (d == null ? void 0 : d.max) === null ||
                      (d == null ? void 0 : d.max) === ""
                        ? null
                        : s(d == null ? void 0 : d.max, 0);
                  return !(w < y || (k != null && w > k));
                });
              })
              .reduce(
                (n, i) => (n ? (s(i.percent, 0) > s(n.percent, 0) ? i : n) : i),
                null,
              );
          if (!a) return;
          const r = e.find(
            (n) => n.getAttribute("data-tier") === String(a.percent),
          );
          r && r.setAttribute("data-active", "true");
        },
        W = (e, t) => {
          if (!b) return;
          const a = Array.isArray(t) && t.length ? t : f;
          if (((f = a), (b.innerHTML = ""), !Array.isArray(e) || !e.length)) {
            const n = document.createElement("li");
            ((n.textContent = "No offers configured yet."),
              b.appendChild(n),
              (b.dataset.bundleTiers = "[]"),
              (g = []));
            return;
          }
          const r = [...e].sort(
            (n, i) =>
              s(n == null ? void 0 : n.percent, 0) -
              s(i == null ? void 0 : i.percent, 0),
          );
          (r.forEach((n) => {
            const i = document.createElement("li");
            i.setAttribute("data-tier", String(n.percent));
            const p = a.map((d) => {
              var w;
              const y =
                  ((w = n == null ? void 0 : n.requirements) == null
                    ? void 0
                    : w[d.key]) || {},
                k = s(y == null ? void 0 : y.min, 0),
                B =
                  (y == null ? void 0 : y.max) === null ||
                  (y == null ? void 0 : y.max) === ""
                    ? null
                    : s(y == null ? void 0 : y.max, 0);
              return B != null ? `${k}-${B} ${d.label}` : `${k} ${d.label}`;
            });
            ((i.textContent = `Pick ${p.join(" & ")} -> ${n.percent}% off`),
              b.appendChild(i));
          }),
            (b.dataset.bundleTiers = JSON.stringify(r)),
            (g = r),
            z());
        },
        S = () => {
          const e = m.size > 0,
            t = e && M();
          (e ? (t ? x(c, F, !0) : x(c, G, !1)) : x(c, V, !1),
            v && (v.disabled = !t),
            Q(),
            z());
        },
        X = () => {
          (m.clear(),
            j.forEach((e) => {
              const t = e.closest(".bundle-builder__item");
              t && P(t, !1);
            }),
            S());
        },
        Y = (e) => {
          var t;
          const a = e.getAttribute("data-variant-id"),
            r = e.getAttribute("data-role"),
            n =
              (t = e.querySelector(".bundle-builder__item-image")) == null
                ? void 0
                : t.getAttribute("src");
          if (!a || !r) return;
          if (m.has(a)) {
            (m.delete(a), P(e, !1), S());
            return;
          }
          const i = f.find((p) => p.key === r);
          if (i) {
            const p = E(m),
              d = i.max === null || i.max === "" ? null : s(i.max, 0);
            if (d != null && (p[r] || 0) + 1 > d) return;
          }
          (m.set(a, { role: r, quantity: 1, image: n }), P(e, !0), S());
        },
        Z = async () => {
          if (!b || g.length) return;
          const e = $(),
            t = `${e}/price?config=1&rulebookId=${encodeURIComponent(C || "")}`,
            a = [12e3, 8e3, 8e3];
          for (let r = 0; r < a.length; r += 1)
            try {
              const n = await q(
                t,
                { method: "GET", headers: { Accept: "application/json" } },
                a[r],
              );
              if (!n.ok) {
                if (r === a.length - 1) {
                  _("Bundle offers are unavailable right now. Refresh in a moment.");
                }
                continue;
              }
              const i = await n.json(),
                p = i == null ? void 0 : i.rulebook;
              if (!p) {
                if (r === a.length - 1) {
                  _("Bundle offers are unavailable right now. Refresh in a moment.");
                }
                continue;
              }
              return (
                window.localStorage &&
                  window.localStorage.setItem(
                    J,
                    JSON.stringify({
                      categories: p.categories || [],
                      tiers: p.tiers || [],
                    }),
                  ),
                _(""),
                W(p.tiers || [], p.categories || []),
                !0
              );
            } catch (n) {
              if (r === a.length - 1) {
                _("Bundle offers are unavailable right now. Refresh in a moment.");
                return !1;
              }
              await new Promise((i) => setTimeout(i, 500 * (r + 1)));
            }
          return !1;
        },
        ee = async (e, t) => {
          try {
            const a = await q(
              `${$()}/price`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({
                  bundleId: e,
                  rulebookId: C,
                  components: t,
                }),
              },
              8e3,
            );
            if (a.status === 404)
              return (
                _("Bundle pricing is unavailable. Check the app proxy path."),
                null
              );
            if (!a.ok)
              return (_("Bundle pricing failed. Please try again."), null);
            _("");
            const r = await a.json();
            return (r != null && r.pathPrefix && K(r.pathPrefix), r);
          } catch (a) {
            return (
              _("Bundle pricing is unavailable. Check the app proxy path."),
              null
            );
          }
        };
      let te = !g.length,
        ae = 0;
      const re = async () => {
        if (!te) return;
        const e = await Z();
        if (e) {
          te = !1;
          return;
        }
        ae += 1;
        if (ae < 10) {
          setTimeout(re, 3e3);
        }
      };
      (j.forEach((e) => {
        const t = e.closest(".bundle-builder__item");
        t && e.addEventListener("click", () => Y(t));
      }),
        g.length || re(),
        v == null ||
          v.addEventListener("click", async () => {
            if (!M() || m.size === 0) {
              S();
              return;
            }
            if (!L) return;
            const e = D(),
              t = Array.from(m.entries()).map(([n, i]) => ({
                id: String(n),
                quantity: i.quantity,
                role: i.role,
              }));
            ((await ee(e, t)) ||
              x(c, "Pricing unavailable. Adding bundle anyway.", !1),
              (v.disabled = !0));
            const a = document.cookie.match(/(?:^|; )cart=([^;]+)/),
              r = a ? a[1] : "";
            try {
              const n = await q(
                `${$()}/add-bundle`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  credentials: "same-origin",
                  body: JSON.stringify({
                    bundleId: e,
                    rulebookId: C,
                    parentVariantId: L,
                    components: t,
                    cartToken: r,
                  }),
                },
                12e3,
              );
              if (!n.ok) {
                (x(c, "Unable to add bundle. Please try again.", !1),
                  (v.disabled = !1));
                return;
              }
              const i = await n.json().catch(() => null),
                p = (i == null ? void 0 : i.cart) || null;
              (i != null &&
                i.cartToken &&
                (document.cookie = `cart=${i.cartToken}; path=/; SameSite=Lax`),
                document.dispatchEvent(
                  new CustomEvent("cart:update", {
                    bubbles: !0,
                    detail: {
                      resource: p,
                      sourceId: "bundle-builder",
                      data: {
                        source: "bundle-builder",
                        itemCount: p == null ? void 0 : p.item_count,
                      },
                    },
                  }),
                ),
                X());
            } catch (n) {
              v.disabled = !1;
            }
          }),
        S());
    },
    N = () => document.querySelectorAll(".bundle-builder").forEach(H);
  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", N)
    : N();
})();
