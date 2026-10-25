import { Sidebar } from "./Sidebar.js";
import { PlayerList } from "./PlayerList.js";
import { WorldList } from "./WorldList.js";
import { UICoordinates } from "./UICoordinates.js";
import { LayerControl } from "./LayerControl.js";
import { Shops } from "./Shops.js";
import { Towns } from "./Towns.js";
import { TownPanel } from "./TownPanel.js";
import { Borders } from "./Borders.js";
import { ChunkGrid } from "./ChunkGrid.js";
let GlobeRendererModule = null;
import L from "leaflet";
import "./addons/Ellipse.js";
import "./addons/RotateMarker.js";
import "leaflet/dist/leaflet.css";
import "../css/styles.css";

class SquaremapMap {
    /** @type {L.Map} */
    map;
    /** @type {LayerControl} */
    layerControl;
    /** @type {boolean} */
    staticMode;
    /** @type {string} */
    title;
    /** @type {Sidebar} */
    sidebar;
    /** @type {PlayerList} */
    playerList;
    /** @type {WorldList} */
    worldList;
    /** @type {UICoordinates} */
    coordinates;
    /** @type {number} */
    tick_count;
    /** @type {boolean} */
    showControls;

    constructor() {
        this.map = L.map("map", {
            crs: L.CRS.Simple,
            center: [0, 0],
            attributionControl: false,
            preferCanvas: true,
            noWrap: true,
        })
            .on("overlayadd", (e) => {
                this.layerControl.showLayer(e.layer);
            })
            .on("overlayremove", (e) => {
                this.layerControl.hideLayer(e.layer);
            })
            .on("click", () => {
                this.playerList.followPlayerMarker(null);
            })
            .on("dblclick", () => {
                this.playerList.followPlayerMarker(null);
            })
            .on("layeradd layerremove", (e) => {
                this.sidebar?.syncToggle(e.layer);
            })
            .on("zoomend", () => this.updateDetail());

        this.tick_count = 1;

        this.layerControl = new LayerControl();

        this.init();
    }
    loop() {
        if (document.visibilityState === "visible") {
            this.tick();
            this.tick_count++;
        }
        setTimeout(() => this.loop(), 1000);
    }
    tick() {
        // tick player tracker
        this.playerList.tick();
        // tick world
        this.worldList.curWorld.tick();
        // tick globe markers
        if (this.currentViewMode === "globe") {
            this.globeRenderer?.updateMarkersScreenPos();
        }
    }
    init() {
        this.getJSON(
            "tiles/settings.json",
            /** @param {Settings} json */
            (json) => {
                this.layerControl.init();

                this.staticMode = json.static || false;
                this.title = json.ui.title;
                this.sidebar = new Sidebar(json.ui.sidebar, this.getUrlParam("show_sidebar", "true") === "true");
                this.playerList = new PlayerList(json.ui.sidebar);
                this.shops = new Shops();
                this.towns = new Towns();
                this.townPanel = new TownPanel();
                this.borders = new Borders();
                this.chunkGrid = new ChunkGrid();
                this.worldList = new WorldList(json.worlds);
                this.coordinates = new UICoordinates(
                    json.ui.coordinates,
                    this.getUrlParam("show_coordinates", "true") === "true",
                );

                this.showControls = this.getUrlParam("show_controls", "true") === "true";
                if (!this.showControls) {
                    document.body.classList.add("no-controls");
                }

                this.worldList.loadInitialWorld(json, (world) => {
                    this.loop();
                    const initX = Number(this.getUrlParam("x", world.spawn.x));
                    const initZ = Number(this.getUrlParam("z", world.spawn.z));
                    const initZoom = Number(this.getUrlParam("zoom", world.zoom.def));
                    this.centerOn(initX, initZ, initZoom);
                    this.setupViewMode(initX, initZ, initZoom);
                    // a shared link can open a town: ?town=Athens
                    const town = this.getUrlParam("town", null);
                    if (town) this.townPanel.open(town, this.getUrlParam("diplomacy", null));
                });
            },
        );
    }
    /** Meridian: player nameplates only when zoomed right in (1 pixel = 1 block or closer); dots and a hover name further out. */
    updateDetail() {
        const world = this.worldList?.curWorld;
        if (world?.zoom == null) return;
        this.map.getContainer().classList.toggle("m-far", this.map.getZoom() < world.zoom.max);
    }
    setupViewMode(x, z, zoom) {
        const globeBtn = document.getElementById("btn-view-globe");
        const flatBtn = document.getElementById("btn-view-flat");
        const globeContainer = document.getElementById("globe-container");
        const mapContainer = document.getElementById("map");
        const tutorialBubble = document.getElementById("view-tutorial-bubble");
        const dismissBtn = document.getElementById("btn-dismiss-tutorial");

        const dismiss = () => {
            if (tutorialBubble) {
                tutorialBubble.setAttribute("hidden", "");
                window.localStorage.setItem("meridian_map_tutorial_seen", "1");
            }
        };

        if (dismissBtn) {
            dismissBtn.addEventListener("click", dismiss);
        }

        const tutorialSeen = window.localStorage.getItem("meridian_map_tutorial_seen");
        if (!tutorialSeen && tutorialBubble) {
            tutorialBubble.removeAttribute("hidden");
        }

        const initGlobe = async () => {
            if (this.globeRenderer) return this.globeRenderer;
            if (!GlobeRendererModule) {
                GlobeRendererModule = await import("./GlobeRenderer.js");
            }
            this.globeRenderer = new GlobeRendererModule.GlobeRenderer({
                container: globeContainer,
                S: this,
                onError: (err) => {
                    console.warn("Globe unavailable, using the flat map:", err);
                    this.setMapMode("flat");
                },
            });
            return this.globeRenderer;
        };

        this.currentViewMode = window.localStorage.getItem("meridian_map_mode") || "globe";

        this.setMapMode = async (mode) => {
            dismiss();
            if (mode === "flat") {
                if (this.currentViewMode === "globe" && this.globeRenderer) {
                    const view = this.globeRenderer.getView();
                    this.centerOn(view.x, view.z, view.zoom);
                }
                this.currentViewMode = "flat";
                window.localStorage.setItem("meridian_map_mode", "flat");
                globeContainer?.setAttribute("hidden", "");
                mapContainer?.removeAttribute("hidden");
                globeBtn?.classList.remove("active");
                globeBtn?.setAttribute("aria-pressed", "false");
                flatBtn?.classList.add("active");
                flatBtn?.setAttribute("aria-pressed", "true");
                this.globeRenderer?.setActive(false);
                this.map.invalidateSize();
            } else {
                let initView = null;
                if (this.currentViewMode === "flat") {
                    const center = this.toPoint(this.map.getCenter());
                    const curZoom = this.map.getZoom();
                    initView = { x: center.x, z: center.y, zoom: curZoom };
                } else if (!this.globeRenderer) {
                    initView = { x, z, zoom };
                }
                this.currentViewMode = "globe";
                window.localStorage.setItem("meridian_map_mode", "globe");
                mapContainer?.setAttribute("hidden", "");
                globeContainer?.removeAttribute("hidden");
                flatBtn?.classList.remove("active");
                flatBtn?.setAttribute("aria-pressed", "false");
                globeBtn?.classList.add("active");
                globeBtn?.setAttribute("aria-pressed", "true");

                const renderer = await initGlobe();
                if (initView) renderer.setView(initView);
                renderer.setActive(true);
                renderer.syncOverlays();
            }
        };

        globeBtn?.addEventListener("click", () => this.setMapMode("globe"));
        flatBtn?.addEventListener("click", () => this.setMapMode("flat"));

        window.addEventListener("keydown", (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
            if (e.key === "g" || e.key === "G") {
                this.setMapMode(this.currentViewMode === "globe" ? "flat" : "globe");
            }
        });

        if (this.currentViewMode === "flat") {
            this.setMapMode("flat");
        } else {
            this.setMapMode("globe");
        }
    }

    centerOn(x, z, zoom) {
        this.map.setView(this.toLatLng(x, z), zoom);
        return this.map;
    }
    toLatLng(x, z) {
        return L.latLng(this.pixelsToMeters(-z), this.pixelsToMeters(x));
        //return this.map.unproject([x, z], this.worldList.curWorld.zoom.max);
    }
    toPoint(latlng) {
        return L.point(this.metersToPixels(latlng.lng), this.metersToPixels(-latlng.lat));
        //return this.map.project(latlng, this.worldList.curWorld.zoom.max);
    }
    pixelsToMeters(num) {
        return num * this.scale;
    }
    metersToPixels(num) {
        return num / this.scale;
    }
    setScale(zoom) {
        this.scale = 1 / Math.pow(2, zoom);
        // store this on map for ellipse
        this.map.options.scale = this.scale;
    }
    createElement(tag, id, parent) {
        const element = document.createElement(tag);
        element.id = id;
        element.parent = parent;
        return element;
    }
    createTextElement(tag, text) {
        const element = document.createElement(tag);
        element.appendChild(document.createTextNode(text));
        return element;
    }
    /**
     * @param {string} url
     * @param {(json: any) => void} fn
     * @param {boolean} cache
     */
    getJSON(url, fn, cache = false) {
        /** @type {RequestInit} */
        let options = {};
        if (!cache) {
            options.cache = "no-store";
        }
        fetch(url, options).then(async (res) => {
            if (res.ok) {
                fn(await res.json());
            }
        });
    }
    getUrlParam(query, def) {
        const url = window.location.search.substring(1);
        const vars = url.split("&");
        for (let i = 0; i < vars.length; i++) {
            const param = vars[i].split("=");
            if (param[0] === query) {
                const value = param[1] === undefined ? "" : decodeURIComponent(param[1]);
                return value === "" ? def : value;
            }
        }
        return def;
    }
    getUrlFromView() {
        const center = this.toPoint(this.map.getCenter());
        const zoom = this.map.getZoom();
        const x = Math.floor(center.x);
        const z = Math.floor(center.y);
        let link;
        if (this.playerList.following) {
            link = `?uuid=${this.playerList.following}&zoom=${zoom}`;
        } else {
            link = `?world=${this.worldList.curWorld.name}&zoom=${zoom}&x=${x}&z=${z}`;
        }
        if (!this.showControls) {
            link += "&show_controls=false";
        }
        if (!this.coordinates.showCoordinates) {
            link += "&show_coordinates=false";
        }
        if (!this.sidebar.showSidebar) {
            link += "&show_sidebar=false";
        }
        return link;
    }
    updateBrowserUrl(url) {
        window.history.replaceState(null, "", url);
    }
}

export const S = new SquaremapMap();

// Meridian: right-click does nothing on the site except the map's copy-coordinates popup
document.addEventListener("contextmenu", (e) => e.preventDefault());

// https://stackoverflow.com/a/3955096
Array.prototype.remove = function () {
    var what,
        a = arguments,
        L = a.length,
        ax;
    while (L && this.length) {
        what = a[--L];
        while ((ax = this.indexOf(what)) !== -1) {
            this.splice(ax, 1);
        }
    }
    return this;
};

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        S.sidebar.remove();
        S.map.remove();
    });
    import.meta.hot.accept();
}
