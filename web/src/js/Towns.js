import L from "leaflet";
import { S } from "./Squaremap.js";

/**
 * Meridian: find a town in the side panel. The list comes from MapTowny's town and capital icons in the
 * "towny" marker layer, so it stays in step with the map (refreshed whenever that layer is).
 */
const WORLD = "minecraft_overworld";
const MAX_ROWS = 200;

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

const nice = (s) => String(s || "").replace(/_/g, " ");

class Towns {
    constructor() {
        /** @type {Array<{name: string, nation: string, capital: boolean, residents: number, x: number, z: number, popup: string}>} */
        this.towns = [];
        this.loaded = false;
        this.input = document.getElementById("town-search");
        this.list = document.getElementById("town-list");
        this.meta = document.getElementById("town-meta");
        this.count = document.getElementById("town-count");
        this.input.addEventListener("input", () => this.render());
        this.render();
    }
    /** @param markers {Array<any>} the raw "towny" layer markers from markers.json */
    update(markers) {
        const towns = [];
        for (const m of markers) {
            if (m.type !== "icon" || !/town_icon|capital_icon/.test(m.icon || "")) continue;
            const name = (/<b>([^<]+)<\/b>/.exec(m.tooltip || "") || [])[1];
            if (!name || m.point == null) continue;
            const nation = (/class="muted">([^<]*)</.exec(m.tooltip || "") || [])[1] || "";
            const residents = Number((/Residents<\/span><span>(\d+)/.exec(m.popup || "") || [])[1] || 0);
            towns.push({
                name,
                nation,
                capital: /capital/.test(m.icon),
                residents,
                x: m.point.x,
                z: m.point.z,
                popup: String(m.popup || "").replace(/%row%|%tip%/g, ""),
            });
        }
        towns.sort((a, b) => b.residents - a.residents || a.name.localeCompare(b.name));
        this.towns = towns;
        this.loaded = true;
        this.render();
    }
    render() {
        this.count.textContent = String(this.towns.length);
        const words = this.input.value.trim().toLowerCase().replace(/_/g, " ").split(/\s+/).filter(Boolean);
        const hits = this.towns.filter((t) => {
            const hay = `${nice(t.name)} ${nice(t.nation)}`.toLowerCase();
            return words.every((w) => hay.includes(w));
        });
        if (!this.loaded) this.meta.textContent = "Loading towns…";
        else if (this.towns.length === 0) this.meta.textContent = "No towns yet.";
        else if (hits.length === 0) this.meta.textContent = `No town or nation matches "${this.input.value.trim()}".`;
        else
            this.meta.textContent = words.length
                ? `${hits.length} of ${this.towns.length} towns`
                : "Biggest towns first. Search a town or nation.";

        const rows = hits.slice(0, MAX_ROWS).map((t) => {
            const row = el("button", "trow");
            row.type = "button";
            const top = el("span", "t-top");
            top.append(el("span", "t-name", nice(t.name)));
            if (t.capital) top.append(el("span", "t-cap", "Capital"));
            const sub = el(
                "span",
                "t-sub",
                [
                    t.nation ? nice(t.nation) : "No nation",
                    `${t.residents} ${t.residents === 1 ? "resident" : "residents"}`,
                ].join(" · "),
            );
            row.append(top, sub);
            row.addEventListener("click", (e) => {
                e.stopPropagation();
                this.focus(t);
            });
            return row;
        });
        this.list.replaceChildren(...rows);
    }
    /** Fly to a town's home block (switching to the overworld if needed) and open it in the town panel. */
    focus(t) {
        if (S.townPanel) {
            S.townPanel.open(t.name);
            S.townPanel.flyTo(t.name);
            return;
        }
        const open = () => {
            const world = S.worldList.curWorld;
            const at = S.toLatLng(t.x, t.z);
            S.map.setView(at, Math.max(world.zoom.max - 1, 0));
            L.popup({ className: "m-popup", offset: [0, -6] })
                .setLatLng(at)
                .setContent(t.popup)
                .openOn(S.map);
        };
        if (S.worldList.curWorld?.name !== WORLD && S.worldList.worlds.has(WORLD)) {
            S.worldList.showWorld(WORLD, open);
        } else {
            open();
        }
    }
}

export { Towns };
