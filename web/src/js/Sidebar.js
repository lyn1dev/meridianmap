import { S } from "./Squaremap.js";

/** Per-viewer UI memory (panel open, sections expanded). Storage can be missing or blocked, so it never throws. */
const store = {
    get(key, def) {
        try {
            const v = window.localStorage.getItem(`meridian.${key}`);
            return v == null ? def : v;
        } catch {
            return def;
        }
    },
    set(key, value) {
        try {
            window.localStorage.setItem(`meridian.${key}`, value);
        } catch {
            // private window or blocked storage: the UI just won't remember
        }
    },
};

/** Plain text of a layer or player name that may carry HTML formatting. */
function plainText(html) {
    const el = document.createElement("span");
    el.innerHTML = html;
    return el.textContent || "";
}

/**
 * Meridian: the right-hand panel. Collapsible sections (toggles, players, shops) and a tab to slide it away.
 * Keeps the fields the rest of squaremap uses: showSidebar, worlds.element, players.element / players.legend.
 */
class Sidebar {
    /** @type {boolean} */
    showSidebar;

    /**
     * @param {Settings_UI_Sidebar} json
     * @param {boolean} show
     */
    constructor(json, show) {
        this.root = document.getElementById("msidebar");
        this.tab = document.getElementById("msidebar-toggle");
        this.showSidebar = show;
        const narrow = window.matchMedia("(max-width: 700px)").matches;
        this.setOpen(show && store.get("panel", narrow ? "closed" : "open") !== "closed");
        this.tab.addEventListener("click", () => {
            this.setOpen(!this.open);
            store.set("panel", this.open ? "open" : "closed");
        });

        for (const cat of this.root.querySelectorAll(".cat")) {
            const head = cat.querySelector(".cat-h");
            const key = `section.${cat.id}`;
            this.expand(cat, store.get(key, cat.dataset.open === "true" ? "1" : "0") === "1");
            head.addEventListener("click", () => {
                const expanded = head.getAttribute("aria-expanded") !== "true";
                this.expand(cat, expanded);
                store.set(key, expanded ? "1" : "0");
            });
        }

        // clicking anywhere in the panel stops following a player (player rows stop the event themselves)
        this.root.addEventListener("click", () => S.playerList?.followPlayerMarker(null));

        this.worlds = { element: document.getElementById("world-list") };
        this.players = {
            element: document.getElementById("player-list"),
            legend: document.getElementById("player-count"),
        };
        this.toggleList = document.getElementById("toggle-list");
        this.playerEmpty = document.getElementById("player-empty");
        this.playerSearch = document.getElementById("player-search");
        this.playerSearch.addEventListener("input", () => this.filterPlayers());
    }
    setOpen(open) {
        this.open = open;
        document.body.classList.toggle("panel-closed", !open);
        this.tab.setAttribute("aria-expanded", String(open));
        this.tab.setAttribute("aria-label", open ? "Hide panel" : "Show panel");
    }
    expand(cat, expanded) {
        cat.querySelector(".cat-h").setAttribute("aria-expanded", String(expanded));
        cat.querySelector(".cat-b").hidden = !expanded;
    }
    /** Show only the players whose name matches the search box; show the empty line when nothing is listed. */
    filterPlayers() {
        const q = this.playerSearch.value.trim().toLowerCase();
        const rows = Array.from(this.players.element.children);
        let shown = 0;
        for (const row of rows) {
            const match = q === "" || row.dataset.name.includes(q);
            row.hidden = !match;
            if (match) shown++;
        }
        this.playerEmpty.hidden = shown > 0;
        this.playerEmpty.textContent = rows.length === 0 ? "Nobody is online right now." : `Nobody online matches "${q}".`;
    }
    /** Rebuild the switches from the overlays squaremap registered (relief, players, markers, shops). */
    renderToggles() {
        const control = S.layerControl.controls;
        if (control == null) return;
        const overlays = control._layers
            .filter((entry) => entry.overlay)
            .sort((a, b) => (a.layer.order ?? 0) - (b.layer.order ?? 0));
        const rows = overlays.map(({ layer, name }) => {
            const id = `toggle-${String(layer.id ?? name).replace(/[^a-z0-9_-]/gi, "_")}`;
            const row = document.createElement("label");
            row.className = "toggle";
            row.htmlFor = id;
            const text = document.createElement("span");
            text.textContent = plainText(name);
            const input = document.createElement("input");
            input.type = "checkbox";
            input.id = id;
            input.setAttribute("role", "switch");
            input.checked = S.map.hasLayer(layer);
            input.addEventListener("change", () => {
                if (input.checked) {
                    layer.addTo(S.map);
                    S.layerControl.showLayer(layer);
                } else {
                    layer.remove();
                    S.layerControl.hideLayer(layer);
                }
            });
            layer._meridianToggle = input;
            row.append(text, input);
            return row;
        });
        this.toggleList.replaceChildren(...rows);
    }
    /** Keep a switch in step when a layer is added or removed some other way. */
    syncToggle(layer) {
        if (layer._meridianToggle) {
            layer._meridianToggle.checked = S.map.hasLayer(layer);
        }
    }
    remove() {
        this.toggleList.replaceChildren();
        this.players.element.replaceChildren();
    }
}

export { Sidebar, plainText, store };
