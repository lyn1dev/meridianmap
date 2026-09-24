import L from "leaflet";
import { S } from "./Squaremap.js";

/** Every chest shop on this server, written next to the tiles by the map plugin once a minute. */
const SHOPS_URL = "tiles/shops.json";
const ICONS = "https://meridianmc.xyz/wiki/icons/";
const REFRESH_MS = 60_000;
const MAX_ROWS = 150;
/** Bukkit world folder -> squaremap world name */
const WORLDS = { world: "minecraft_overworld", world_nether: "minecraft_the_nether", world_the_end: "minecraft_the_end" };

const nice = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const num = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
const itemName = (s) => s.itemName || nice(s.item);
const each = (s) => s.price / (s.amount || 1);

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function icon(id) {
    const img = el("img", "item");
    img.alt = "";
    img.width = 20;
    img.height = 20;
    img.loading = "lazy";
    img.src = `${ICONS}${encodeURIComponent(id)}.png`;
    img.addEventListener("error", () => (img.style.visibility = "hidden"));
    return img;
}

class Shops {
    constructor() {
        /** @type {Array<any>} */
        this.shops = [];
        this.loaded = false;
        this.failed = false;
        this.layer = new L.LayerGroup();
        this.layer.id = "shops_layer";
        this.layer.order = 50;
        this.input = document.getElementById("shop-search");
        this.list = document.getElementById("shop-list");
        this.meta = document.getElementById("shop-meta");
        this.count = document.getElementById("shop-count");
        this.input.addEventListener("input", () => this.render());
        this.load();
        setInterval(() => this.load(), REFRESH_MS);
    }
    load() {
        fetch(SHOPS_URL, { cache: "no-store" })
            .then((res) => {
                if (res.status === 404) return { data: [] }; // not exported yet: no shops
                return res.ok ? res.json() : Promise.reject(new Error(String(res.status)));
            })
            .then((json) => {
                const data = Array.isArray(json.data) ? json.data : [];
                this.shops = data.map((s) => ({ ...s, mapWorld: WORLDS[s.world] || s.world }));
                this.loaded = true;
                this.failed = false;
                this.render();
                this.draw();
            })
            .catch(() => {
                this.failed = true;
                this.render();
            });
    }
    /** Called when a world is shown: register the map layer and draw that world's shops. */
    attach() {
        S.layerControl.removeOverlay(this.layer);
        S.layerControl.addOverlay("Shops", this.layer, false);
        this.draw();
    }
    draw() {
        const world = S.worldList?.curWorld;
        this.layer.clearLayers();
        if (world == null || world.zoom == null) return;
        for (const s of this.shops) {
            if (s.mapWorld !== world.name) continue;
            L.circleMarker(S.toLatLng(s.x + 0.5, s.z + 0.5), {
                radius: 5,
                weight: 1.5,
                color: "#1a1403",
                fillColor: s.type === "buying" ? "#6ec1ff" : "#f5c83d",
                fillOpacity: 1,
            })
                .bindTooltip(`${itemName(s)} · ${num(s.price)} g / ${s.amount || 1}`, { direction: "top", offset: [0, -4] })
                .on("click", () => this.focus(s))
                .addTo(this.layer);
        }
    }
    matches(s, words) {
        if (words.length === 0) return true;
        const hay = `${itemName(s)} ${s.item} ${(s.enchants || []).join(" ")} ${s.owner || ""} ${s.town || ""}`
            .toLowerCase()
            .replace(/_/g, " ");
        return words.every((w) => hay.includes(w));
    }
    render() {
        this.count.textContent = num(this.shops.length);
        const q = this.input.value.trim().toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        const hits = this.shops.filter((s) => this.matches(s, words)).sort((a, b) => each(a) - each(b));

        if (this.failed && !this.loaded) {
            this.meta.textContent = "The shop list is not available right now. It will retry in a minute.";
        } else if (!this.loaded) {
            this.meta.textContent = "Loading shops…";
        } else if (this.shops.length === 0) {
            this.meta.textContent = "No chest shops yet. New shops show up here within a minute.";
        } else if (hits.length === 0) {
            this.meta.textContent = `No shop sells or buys "${q}".`;
        } else {
            const shown = Math.min(hits.length, MAX_ROWS);
            this.meta.textContent = `${num(hits.length)} ${hits.length === 1 ? "shop" : "shops"}, cheapest first` +
                (shown < hits.length ? ` (first ${shown})` : "");
        }

        const rows = hits.slice(0, MAX_ROWS).map((s) => {
            const row = el("button", "srow");
            row.type = "button";
            const top = el("span", "s-top");
            const name = el("span", "s-item", itemName(s));
            if (s.enchants) name.title = s.enchants.map(nice).join(", ");
            top.append(icon(s.item), name, el("span", `s-type ${s.type === "buying" ? "buys" : "sells"}`, s.type === "buying" ? "Buys" : "Sells"));
            const price = el("span", "s-price");
            price.append(el("b", null, `${num(s.price)} g`), document.createTextNode(` / ${s.amount || 1}`));
            if ((s.amount || 1) > 1) price.append(el("span", "s-each", ` · ${num(each(s))} g each`));
            const who = el("span", "s-who", [s.owner || "Unknown seller", s.town].filter(Boolean).join(" · "));
            const where = el("span", "s-where", `${s.x}, ${s.y}, ${s.z}`);
            row.append(top, price, who, where);
            row.addEventListener("click", (e) => {
                e.stopPropagation();
                this.focus(s);
            });
            return row;
        });
        this.list.replaceChildren(...rows);
    }
    /** Fly to a shop (switching world if needed) and open its card. */
    focus(s) {
        const open = () => {
            const world = S.worldList.curWorld;
            const at = S.toLatLng(s.x + 0.5, s.z + 0.5);
            S.map.setView(at, world.zoom.max);
            const card = el("div", "shop-card");
            const head = el("div", "c-head");
            head.append(icon(s.item), el("b", null, itemName(s)));
            card.append(head);
            if (s.enchants) card.append(el("div", "c-line muted", s.enchants.map(nice).join(", ")));
            card.append(
                el("div", "c-line", `${s.type === "buying" ? "Buys from you" : "Sells to you"}: ${num(s.price)} g for ${s.amount || 1}`),
                el("div", "c-line muted", `Stock: ${s.stock == null ? "unknown" : num(s.stock)}`),
                el("div", "c-line", `Seller: ${s.owner || "unknown"}${s.town ? ` · ${s.town}` : ""}`),
                el("div", "c-line mono", `X ${s.x}  Y ${s.y}  Z ${s.z}`),
            );
            L.popup({ className: "m-popup", offset: [0, -2] }).setLatLng(at).setContent(card).openOn(S.map);
        };
        if (S.worldList.worlds.has(s.mapWorld)) {
            S.worldList.showWorld(s.mapWorld, open);
        } else {
            open();
        }
    }
}

export { Shops };
