import { S } from "./Squaremap.js";
import L from "leaflet";
import { SquaremapTileLayer } from "./SquaremapTileLayer.js";

class LayerControl {
    /** @type {number} */
    currentLayer;
    /** @type {number} */
    updateInterval;
    /** @type {L.LayerGroup} */
    playersLayer;
    /** @type {L.Control.Layers} */
    controls;
    /** @type {L.TileLayer} */
    tileLayer1;
    /** @type {L.TileLayer} */
    tileLayer2;
    /** @type {L.Layer} */
    ignoreLayer;
    /** @type {L.TileLayer | null} */
    reliefLayer = null;

    init() {
        this.currentLayer = 0;
        this.updateInterval = 60;

        this.playersLayer = new L.LayerGroup();
        this.playersLayer.id = "players_layer";

        this.controls = L.control
            .layers(
                {},
                {},
                {
                    position: "topleft",
                    sortLayers: true,
                    sortFunction: (a, b) => {
                        return a.order - b.order;
                    },
                },
            )
            .addTo(S.map);
        // Meridian: the switches live in the side panel; Leaflet's own box stays as the registry only
        this.controls.getContainer().style.display = "none";
    }
    /**
     * @param name {string}
     * @param layer {L.Layer}
     * @param hide {boolean}
     */
    addOverlay(name, layer, hide) {
        this.controls.addOverlay(layer, name);
        if (this.shouldHide(layer, hide) !== true) {
            layer.addTo(S.map);
        }
        S.sidebar?.renderToggles();
    }
    /**
     * @param layer {L.Layer}
     */
    removeOverlay(layer) {
        this.ignoreLayer = layer;
        this.controls.removeLayer(layer);
        layer.remove();
        this.ignoreLayer = null;
        S.sidebar?.renderToggles();
    }
    /**
     * @param layer {L.Layer}
     * @param def {boolean}
     * @returns {boolean}
     */
    shouldHide(layer, def) {
        const value = window.localStorage.getItem(`hide_${layer.id}`);
        return value == null ? def : value === "true";
    }
    /**
     * @param layer {L.Layer}
     */
    hideLayer(layer) {
        if (layer !== this.ignoreLayer) {
            window.localStorage.setItem(`hide_${layer.id}`, "true");
        }
    }
    /**
     * @param layer {L.Layer}
     */
    showLayer(layer) {
        if (layer !== this.ignoreLayer) {
            window.localStorage.setItem(`hide_${layer.id}`, "false");
        }
    }
    /**
     * @param world {World}
     */
    setupTileLayers(world) {
        // setup the map tile layers
        // we need 2 layers to swap between for seamless refreshing
        if (this.tileLayer1 != null) {
            S.map.removeLayer(this.tileLayer1);
        }
        if (this.tileLayer2 != null) {
            S.map.removeLayer(this.tileLayer2);
        }
        this.tileLayer1 = this.createTileLayer(world);
        this.tileLayer2 = this.createTileLayer(world);

        this.setupReliefLayer(world);

        // refresh player's control
        this.removeOverlay(this.playersLayer);
        if (world.player_tracker.show_controls) {
            this.addOverlay(world.player_tracker.label, this.playersLayer, world.player_tracker.default_hidden);
        }
        this.playersLayer.order = world.player_tracker.priority;
        this.playersLayer.setZIndex(world.player_tracker.z_index);

        // Meridian: chest shops as a switchable layer
        S.shops?.attach();
    }
    /**
     * @param world {World}
     * @returns {L.TileLayer}
     */
    createTileLayer(world) {
        return new SquaremapTileLayer(`tiles/${world.name}/{z}/{x}_{y}.png`, {
            tileSize: 512,
            minNativeZoom: 0,
            maxNativeZoom: world.zoom.max,
            errorTileUrl: "images/clear.png",
        })
            .addTo(S.map)
            .addEventListener("load", () => {
                // when all tiles are loaded, switch to this layer
                this.switchTileLayer();
            });
    }
    /**
     * Meridian: hill shading drawn over the map tiles and blended with them, switchable like any other layer.
     * @param world {World}
     */
    setupReliefLayer(world) {
        if (this.reliefLayer != null) {
            this.removeOverlay(this.reliefLayer);
            this.reliefLayer = null;
        }
        const relief = world.relief;
        if (relief == null || !relief.enabled) {
            return;
        }
        const pane = S.map.getPane("relief") || S.map.createPane("relief");
        pane.style.zIndex = "250";
        pane.style.pointerEvents = "none";
        pane.style.mixBlendMode = relief.blend_mode || "hard-light";
        pane.style.opacity = String(relief.opacity ?? 1);
        this.reliefLayer = new SquaremapTileLayer(`tiles/${world.name}/relief/{z}/{x}_{y}.png`, {
            tileSize: 512,
            minNativeZoom: 0,
            maxNativeZoom: world.zoom.max,
            errorTileUrl: "images/clear.png",
            pane: "relief",
        });
        this.reliefLayer.id = "relief_layer";
        this.reliefLayer.order = -100;
        this.addOverlay(relief.label || "Relief", this.reliefLayer, relief.default_hidden === true);
    }
    updateTileLayer() {
        // redraw background tile layer
        if (this.currentLayer === 1) {
            this.tileLayer2.redraw();
        } else {
            this.tileLayer1.redraw();
        }
    }
    switchTileLayer() {
        // swap current tile layer
        if (this.currentLayer === 1) {
            this.tileLayer1.setZIndex(0);
            this.tileLayer2.setZIndex(1);
            this.currentLayer = 2;
        } else {
            this.tileLayer1.setZIndex(1);
            this.tileLayer2.setZIndex(0);
            this.currentLayer = 1;
        }
    }
}

export { LayerControl };
