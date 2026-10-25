import { S } from "./Squaremap.js";

/**
 * Meridian: the town panel. Clicking a town's land or icon opens it on the left instead of a popup: the town's details
 * from the stats site's data (the same files, refreshed every few minutes), its residents, and a Diplomacy view that
 * colours every town on the map by how its nation stands with this town's nation. Until the stats data has the town
 * (a town founded in the last few minutes, say) the panel falls back on what MapTowny's own card says.
 */
const API = "https://stats.meridianmc.xyz/api/";
const STATS = "https://stats.meridianmc.xyz/#/";
const FRESH_MS = 120000;
const WORLD = "minecraft_overworld";
const DIPLOMACY_KEY = "meridian_map_diplomacy";
const SELECTED = "#f5c83d";

/** Diplomacy colours, by how a town's nation stands with the viewing town's nation. */
const RELATIONS = {
    self: { color: "#3fd17a", fill: 0.34, label: "Own nation" },
    ally: { color: "#a6e35a", fill: 0.26, label: "Allies & federation" },
    enemy: { color: "#f05454", fill: 0.34, label: "Enemies" },
    other: { color: "#8a9099", fill: 0.05, label: "Everyone else" },
};

const lc = (s) => String(s ?? "").toLowerCase();
const nice = (s) => String(s ?? "").replace(/_/g, " ");
const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const date = (ms) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const statsLink = (kind, name) => `${STATS}${kind}/${encodeURIComponent(name)}`;

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function svg(paths, size = 14) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 16 16");
    s.setAttribute("width", String(size));
    s.setAttribute("height", String(size));
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = paths;
    return s;
}

const ICON_OUT = '<path d="M6 3h7v7M13 3L5 11" fill="none" stroke="currentColor" stroke-width="1.6"/>';
const ICON_LOCATE =
    '<circle cx="8" cy="8" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/>' +
    '<path d="M8 .5v3M8 12.5v3M.5 8h3M12.5 8h3" stroke="currentColor" stroke-width="1.6"/>';
const ICON_CLOSE = '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.8"/>';

class TownPanel {
    constructor() {
        /** @type {{towns: Map<string, any>, nations: Map<string, any>, fedOf: Map<string, any>, online: Set<string>} | null} */
        this.data = null;
        this.loadedAt = 0;
        this.loading = null;
        /** the open town's name, as the map spells it */
        this.current = null;
        this.tab = "overview";
        /** town name -> its claim shapes on the flat map */
        this.claims = new Map();
        try {
            this.diplomacy = window.localStorage.getItem(DIPLOMACY_KEY) === "1";
        } catch {
            this.diplomacy = false;
        }
        this.build();
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape" || !this.current) return;
            if (e.target instanceof HTMLInputElement && e.target.type !== "checkbox") return;
            this.close();
        });
        // keep the data (and so the diplomacy colours) fresh while the panel is up
        setInterval(() => {
            if (this.current && document.visibilityState === "visible")
                this.load(true).then((changed) => changed && this.refresh());
        }, FRESH_MS);
    }

    build() {
        const root = el("aside", null);
        root.id = "town-panel";
        root.setAttribute("aria-label", "Town");
        root.inert = true;

        const scroll = el("div", "tp-scroll");
        const top = el("div", "tp-top");
        this.kind = el("span", "tp-kind", "Town");
        this.capital = el("span", "t-cap", "Capital");
        const actions = el("div", "tp-actions");
        this.locate = el("button", "tp-btn");
        this.locate.type = "button";
        this.locate.title = "Fly to the town";
        this.locate.setAttribute("aria-label", "Fly to the town");
        this.locate.append(svg(ICON_LOCATE, 15));
        this.locate.addEventListener("click", () => this.flyTo());
        const close = el("button", "tp-btn");
        close.type = "button";
        close.title = "Close";
        close.setAttribute("aria-label", "Close the town panel");
        close.append(svg(ICON_CLOSE, 13));
        close.addEventListener("click", () => this.close());
        actions.append(this.locate, close);
        top.append(this.kind, this.capital, actions);

        this.name = el("h2", "tp-name");
        this.level = el("div", "tp-level");
        this.nation = el("a", "tp-nation");
        this.nation.target = "_blank";
        this.nation.rel = "noopener";

        this.mayor = el("div", "tp-mayor");

        const tabs = el("div", "tp-tabs");
        tabs.setAttribute("role", "tablist");
        this.tabButtons = {};
        for (const [key, label] of [
            ["overview", "Overview"],
            ["residents", "Residents"],
        ]) {
            const b = el("button", "tp-tab");
            b.type = "button";
            b.setAttribute("role", "tab");
            b.append(el("span", null, label));
            if (key === "residents") {
                this.residentCount = el("span", "n");
                b.append(this.residentCount);
            }
            b.addEventListener("click", () => {
                this.tab = key;
                this.render();
            });
            this.tabButtons[key] = b;
            tabs.append(b);
        }
        this.body = el("div", "tp-body");
        scroll.append(top, this.name, this.level, this.nation, this.mayor, tabs, this.body);

        const foot = el("div", "tp-foot");
        const toggle = el("label", "toggle");
        const words = el("span", "tp-dip");
        words.append(el("b", null, "Diplomacy"));
        this.viewAs = el("small");
        words.append(this.viewAs);
        this.toggle = el("input");
        this.toggle.type = "checkbox";
        this.toggle.checked = this.diplomacy;
        this.toggle.setAttribute("aria-label", "Diplomacy view");
        this.toggle.addEventListener("change", () => {
            this.diplomacy = this.toggle.checked;
            try {
                window.localStorage.setItem(DIPLOMACY_KEY, this.diplomacy ? "1" : "0");
            } catch {
                // private window: the toggle just isn't remembered
            }
            this.render();
            this.applyStyles();
        });
        toggle.append(words, this.toggle);
        this.legend = el("div", "tp-legend");
        foot.append(toggle, this.legend);

        root.append(scroll, foot);
        document.body.append(root);
        this.root = root;
        this.scroll = scroll;
    }

    // ------------------------------------------------------------------ data

    /** Fetches the stats site's towns, nations, federations and who's online. Resolves true when something new came in. */
    load(force) {
        if (!force && this.data && Date.now() - this.loadedAt < FRESH_MS) return Promise.resolve(false);
        if (this.loading) return this.loading;
        const get = (file) =>
            fetch(API + file, { cache: "no-cache" })
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null);
        this.loading = Promise.all(["towns.json", "nations.json", "federations.json", "server.json"].map(get))
            .then(([towns, nations, feds, server]) => {
                if (!towns?.data) return false;
                const fedOf = new Map();
                for (const f of feds?.data ?? []) for (const n of f.nations ?? []) fedOf.set(lc(n), f);
                this.data = {
                    towns: new Map(towns.data.map((t) => [lc(t.name), t])),
                    nations: new Map((nations?.data ?? []).map((n) => [lc(n.name), n])),
                    fedOf,
                    online: new Set((server?.data?.online ?? []).map((p) => lc(p.name))),
                };
                this.loadedAt = Date.now();
                return true;
            })
            .finally(() => {
                this.loading = null;
            });
        return this.loading;
    }

    /** What MapTowny's card for a town says, for when the stats data doesn't have it (yet). */
    fallback(name) {
        const t = S.towns?.towns.find((x) => x.name === name);
        if (!t) return null;
        const doc = new DOMParser().parseFromString(t.popup || "", "text/html");
        const lines = {};
        for (const line of doc.querySelectorAll(".c-line")) {
            const [k, v] = line.querySelectorAll("span");
            if (k && v) lines[k.textContent.trim()] = v.textContent.trim();
        }
        return {
            ...t,
            lines,
            board: doc.querySelector(".c-board")?.textContent.trim() || "",
        };
    }

    /** Everything the panel shows about a town, from the stats data or the map's own card. */
    model(name) {
        const t = this.data?.towns.get(lc(name));
        const fb = this.fallback(name);
        if (!t && !fb) return { name, residents: null, count: 0, perms: [] };
        const nation = t ? t.nation : fb.nation || null;
        const fed = nation ? this.data?.fedOf.get(lc(nation)) : null;
        const perms = [];
        if (t) {
            const add = (label, value) => value != null && perms.push([label, value]);
            add("Public spawn", t.public);
            add("Open to join", t.open);
            add("Peaceful", t.peaceful);
            add("PvP", t.pvp);
            add("Mob spawning", t.mobs);
            add("Explosions", t.explosion);
            add("Fire spread", t.fire);
        }
        return {
            name,
            capital: t ? t.capital : fb.capital,
            level: t?.levelName ? t.levelName.replace(/[()]/g, "").trim() : "",
            nation,
            nationColour: nation ? this.data?.nations.get(lc(nation))?.color : null,
            federation: fed ? fed.name : fb?.lines.Federation || null,
            federationColour: fed?.color || null,
            mayor: t ? t.mayor : fb.lines.Mayor || null,
            residents: t ? t.residents : null,
            count: t ? t.residents.length : fb.residents,
            founded: t?.founded ? date(t.founded) : fb?.lines.Founded || null,
            claims: t?.claims ?? null,
            maxClaims: t?.maxClaims ?? null,
            bank: t ? `${fmt(Math.floor(t.bank || 0))} g` : fb.lines.Bank || null,
            religion: t?.religion || null,
            board: t ? t.board || "" : fb.board,
            x: t?.x ?? fb?.x,
            z: t?.z ?? fb?.z,
            ruined: !!t?.ruined,
            perms,
            listed: !!t,
        };
    }

    // ------------------------------------------------------------------ open / close

    /** @param diplomacy {string | null} "1" or "0" from a shared link, to start with the Diplomacy view on or off */
    open(name, diplomacy = null) {
        if (!name) return;
        if (diplomacy === "1" || diplomacy === "0") this.diplomacy = diplomacy === "1";
        if (this.current !== name) {
            this.tab = "overview";
            this.scroll.scrollTop = 0;
        }
        this.current = name;
        this.root.inert = false;
        document.body.classList.add("town-open");
        this.render();
        this.applyStyles();
        this.load().then((changed) => {
            if (changed && this.current === name) this.refresh();
        });
    }

    close() {
        if (!this.current) return;
        this.current = null;
        this.root.inert = true;
        document.body.classList.remove("town-open");
        this.applyStyles();
    }

    refresh() {
        if (!this.current) return;
        this.render();
        this.applyStyles();
    }

    /** Flies to the town's spawn (switching to the overworld first if needed). */
    flyTo(name = this.current) {
        const m = name ? this.model(name) : null;
        if (m?.x == null) return;
        const go = () => {
            const world = S.worldList.curWorld;
            S.map.setView(S.toLatLng(m.x, m.z), Math.max(world.zoom.max - 1, 0));
        };
        if (S.worldList.curWorld?.name !== WORLD && S.worldList.worlds.has(WORLD)) S.worldList.showWorld(WORLD, go);
        else go();
    }

    // ------------------------------------------------------------------ drawing the panel

    render() {
        const name = this.current;
        if (!name) return;
        const m = this.model(name);

        this.kind.textContent = m.ruined ? "Ruins" : "Town";
        this.capital.hidden = !m.capital;
        this.name.textContent = nice(m.name);
        this.level.textContent = m.level;
        this.level.hidden = !m.level;
        this.locate.hidden = m.x == null;

        this.nation.replaceChildren();
        if (m.nation) {
            const sw = el("i", "tp-sw");
            sw.style.background = m.nationColour ? `#${m.nationColour}` : "var(--muted)";
            this.nation.append(sw, el("span", null, nice(m.nation)), svg(ICON_OUT, 12));
            this.nation.href = statsLink("nation", m.nation);
            this.nation.classList.remove("none");
        } else {
            this.nation.append(el("span", null, "No nation"));
            this.nation.removeAttribute("href");
            this.nation.classList.add("none");
        }

        this.mayor.replaceChildren();
        this.mayor.hidden = !m.mayor;
        if (m.mayor) {
            const skin = el("div", "tp-skin");
            const img = el("img");
            img.alt = "";
            img.loading = "lazy";
            img.src = `https://mc-heads.net/body/${encodeURIComponent(m.mayor)}/72`;
            img.addEventListener("error", () => skin.classList.add("missing"));
            skin.append(img);
            const who = el("div", "tp-who");
            who.append(el("span", "lbl", "Mayor"), el("b", null, m.mayor));
            const link = el("a", "tp-more", "Profile");
            link.href = statsLink("player", m.mayor);
            link.target = "_blank";
            link.rel = "noopener";
            link.append(svg(ICON_OUT, 11));
            who.append(link);
            this.mayor.append(skin, who);
        }

        this.residentCount.textContent = m.count ? String(m.count) : "";
        for (const [key, b] of Object.entries(this.tabButtons))
            b.setAttribute("aria-selected", String(this.tab === key));
        this.body.replaceChildren(this.tab === "residents" ? this.residentsPane(m) : this.overviewPane(m));
        this.renderFoot(m);
    }

    overviewPane(m) {
        const pane = el("div", "tp-pane");
        const rows = el("div", "tp-rows");
        const row = (label, value, cls) => {
            if (value == null || value === "") return;
            const r = el("div", "tp-row");
            const v = value instanceof Node ? value : el("span", null, value);
            if (cls) v.classList.add(cls);
            r.append(el("span", null, label), v);
            rows.append(r);
        };
        const link = (kind, name, colour) => {
            const a = el("a");
            a.href = statsLink(kind, name);
            a.target = "_blank";
            a.rel = "noopener";
            if (colour) {
                const sw = el("i", "tp-sw");
                sw.style.background = `#${colour}`;
                a.append(sw);
            }
            a.append(el("span", null, nice(name)));
            return a;
        };
        row("Founded", m.founded);
        row("Nation", m.nation ? link("nation", m.nation, m.nationColour) : "None");
        if (m.federation) row("Federation", link("federation", m.federation, m.federationColour));
        if (m.claims != null)
            row("Town blocks", m.maxClaims ? `${fmt(m.claims)} / ${fmt(m.maxClaims)}` : fmt(m.claims), "tp-mono");
        row("Treasury", m.bank, "tp-gold");
        row("Religion", m.religion);
        if (m.x != null) row("Town spawn", `${m.x}, ${m.z}`, "tp-mono");
        pane.append(rows);

        // Towny's own placeholder board isn't worth showing
        if (m.board && !/^\/town set board/i.test(m.board)) pane.append(el("p", "tp-board", m.board));

        if (m.perms.length) {
            pane.append(el("h3", "tp-h", "Permissions"));
            const perms = el("div", "tp-rows");
            for (const [label, on] of m.perms) {
                const r = el("div", "tp-row");
                r.append(el("span", null, label), el("span", on ? "tp-on" : "tp-off", on ? "✓ Enabled" : "Disabled"));
                perms.append(r);
            }
            pane.append(perms);
        }
        if (m.listed) {
            const more = el("a", "tp-more tp-stats", "Full town page on Stats");
            more.href = statsLink("town", m.name);
            more.target = "_blank";
            more.rel = "noopener";
            more.append(svg(ICON_OUT, 11));
            pane.append(more);
        }
        return pane;
    }

    residentsPane(m) {
        const pane = el("div", "tp-pane");
        if (!m.residents) {
            pane.append(
                el(
                    "p",
                    "empty",
                    m.count
                        ? `${m.count} ${m.count === 1 ? "resident" : "residents"}. The list is loading…`
                        : "Loading…",
                ),
            );
            return pane;
        }
        const online = this.data?.online ?? new Set();
        const people = [...m.residents].sort(
            (a, b) =>
                (b === m.mayor) - (a === m.mayor) ||
                online.has(lc(b)) - online.has(lc(a)) ||
                a.localeCompare(b, undefined, { sensitivity: "base" }),
        );
        const list = el("div", "tp-people");
        for (const p of people) {
            const a = el("a", "tp-person");
            a.href = statsLink("player", p);
            a.target = "_blank";
            a.rel = "noopener";
            const img = el("img");
            img.alt = "";
            img.loading = "lazy";
            img.src = `https://mc-heads.net/avatar/${encodeURIComponent(p)}/24`;
            a.append(img, el("span", "nm", p));
            if (online.has(lc(p))) {
                const dot = el("i", "tp-dot");
                dot.title = "Online now";
                a.append(dot);
            }
            if (p === m.mayor) a.append(el("span", "t-cap", "Mayor"));
            list.append(a);
        }
        pane.append(list);
        return pane;
    }

    renderFoot(m) {
        this.viewAs.textContent = m.nation ? `View as ${nice(m.nation)}` : `View as ${nice(m.name)}`;
        this.toggle.checked = this.diplomacy;
        this.legend.hidden = !this.diplomacy;
        this.legend.replaceChildren();
        const keys = m.nation ? ["self", "ally", "enemy", "other"] : ["self", "other"];
        for (const k of keys) {
            const item = el("span");
            const sw = el("i");
            sw.style.background = RELATIONS[k].color;
            item.append(sw, el("span", null, k === "self" && !m.nation ? "This town" : RELATIONS[k].label));
            this.legend.append(item);
        }
    }

    // ------------------------------------------------------------------ map colours

    /** Called while the map rebuilds MapTowny's layer: forget the old claim shapes. */
    resetClaims() {
        this.claims = new Map();
    }

    /** A town's claim shape on the flat map, with the look MapTowny gave it (to go back to). */
    addClaim(name, layer) {
        const o = layer.options;
        layer._townBase = {
            color: o.color,
            fillColor: o.fillColor,
            opacity: o.opacity,
            fillOpacity: o.fillOpacity,
            weight: o.weight,
        };
        if (!this.claims.has(name)) this.claims.set(name, []);
        this.claims.get(name).push(layer);
    }

    /** How each town's nation stands with the open town's nation: "self", "ally", "enemy" or "other". */
    relations() {
        const me = this.current;
        const nationOf = new Map();
        for (const t of S.towns?.towns ?? []) if (t.nation) nationOf.set(t.name, lc(t.nation));
        for (const t of this.data?.towns.values() ?? []) nationOf.set(t.name, t.nation ? lc(t.nation) : null);
        const mine = nationOf.get(me) ?? null;
        if (!mine) return (name) => (name === me ? "self" : "other");
        const allies = new Set();
        const enemies = new Set();
        const n = this.data?.nations.get(mine);
        for (const a of n?.allies ?? []) allies.add(lc(a));
        for (const e of n?.enemies ?? []) enemies.add(lc(e));
        for (const f of this.data?.fedOf.get(mine)?.nations ?? []) allies.add(lc(f));
        // a nation that has declared this one an enemy is hostile too
        for (const o of this.data?.nations.values() ?? [])
            if ((o.enemies ?? []).some((e) => lc(e) === mine)) enemies.add(lc(o.name));
        return (name) => {
            const theirs = nationOf.get(name);
            if (name === me || theirs === mine) return "self";
            if (!theirs) return "other";
            if (enemies.has(theirs)) return "enemy";
            if (allies.has(theirs)) return "ally";
            return "other";
        };
    }

    /** The colour a town's icon takes in the diplomacy view, or null for its own. */
    iconColour(name) {
        if (!this.diplomacy || !this.current) return null;
        this._rel ??= this.relations();
        return RELATIONS[this._rel(name)].color;
    }

    /** Colours every claim for the diplomacy view (or back to its own), and outlines the open town. */
    applyStyles() {
        const rel = this.diplomacy && this.current ? this.relations() : null;
        this._rel = rel;
        for (const [name, layers] of this.claims) {
            const r = rel ? RELATIONS[rel(name)] : null;
            for (const layer of layers) {
                const base = layer._townBase;
                const style = { ...base };
                if (r) {
                    style.color = r.color;
                    style.fillColor = r.color;
                    style.fillOpacity = r.fill;
                    style.opacity = r === RELATIONS.other ? 0.45 : 0.95;
                }
                if (name === this.current) {
                    style.color = SELECTED;
                    style.opacity = 1;
                    style.weight = Math.max(3, base.weight ?? 2);
                }
                layer.setStyle(style);
            }
        }
        S.worldList?.curWorld?.retintTownIcons();
        S.globeRenderer?.restyleShapes();
    }
}

export { TownPanel };
