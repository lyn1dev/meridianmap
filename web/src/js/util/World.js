import { Options, Rectangle, PolyLine, Polygon, Circle, Ellipse, Icon } from "./Markers.js";
import { S } from "../Squaremap.js";
import L from "leaflet";

class World {
    /** @type {string} */
    name;
    /** @type {string} */
    display_name;
    /** @type {Map<string, L.LayerGroup>} */
    markerLayers;
    /** @type {WorldSettings_PlayerTracker} */
    player_tracker;
    /** @type {number} */
    marker_update_interval;
    /** @type {number} */
    tiles_update_interval;
    /** @type {boolean} */
    staticNeedsMarkerTick;
    /** @type {WorldSettings_Zoom} */
    zoom;
    /** @type {WorldSettings_Spawn} */
    spawn;
    /** @type {WorldSettings_Relief} */
    relief;

    /**
     * @param json {Settings_World}
     */
    constructor(json) {
        this.name = json.name;
        this.order = json.order;
        this.icon = json.icon;
        this.type = json.type;
        this.display_name = json.display_name;
        this.markerLayers = new Map();
        this.player_tracker = {};
        this.marker_update_interval = 5;
        this.tiles_update_interval = 15;
        this.staticNeedsMarkerTick = false;
        // Meridian: town icons (name -> Icon markers) and each town's federation colour, for the Federations overlay
        this.townIcons = new Map();
        this.federationColours = new Map();
    }
    /**
     * Town icons take their diplomacy colour while the town panel's Diplomacy view is on, their federation's colour
     * while the Federations overlay is shown, and their own colour otherwise.
     */
    retintTownIcons() {
        const fed = this.markerLayers.get("meridian_federations");
        const on = fed != null && S.map.hasLayer(fed);
        for (const [name, icons] of this.townIcons) {
            const colour = S.townPanel?.iconColour(name) ?? (on ? this.federationColours.get(name) : null);
            for (const icon of icons) icon.retint(colour);
        }
    }
    tick() {
        // refresh map tile layer
        if (!S.staticMode && S.tick_count % this.tiles_update_interval === 0) {
            S.layerControl.updateTileLayer();
        }
        // load and draw markers
        if (!S.staticMode && S.tick_count % this.marker_update_interval === 0) {
            this.tickMarkers();
        }
        if (S.staticMode && this.staticNeedsMarkerTick) {
            this.tickMarkers();
            this.staticNeedsMarkerTick = false;
        }
    }
    tickMarkers() {
        S.getJSON(
            `tiles/${this.name}/markers.json`,
            (json) => {
                if (this === S.worldList.curWorld) {
                    this.markers(json);
                }
            },
            true,
        );
    }
    unload() {
        S.playerList.clearPlayerMarkers();
        const keys = Array.from(this.markerLayers.keys());
        for (let i = 0; i < keys.length; i++) {
            const layer = this.markerLayers.get(keys[i]);
            S.layerControl.controls.removeLayer(layer);
            layer.remove();
            this.markerLayers.delete(keys[i]);
        }
    }
    /**
     * @param callback {(world: World) => void}
     */
    load(callback) {
        S.getJSON(
            `tiles/${this.name}/settings.json`,
            /** @param {WorldSettings} json */
            (json) => {
                this.player_tracker = json.player_tracker;
                this.zoom = json.zoom;
                this.spawn = json.spawn;
                this.relief = json.relief;
                this.marker_update_interval = json.marker_update_interval;
                this.tiles_update_interval = json.tiles_update_interval;
                this.staticNeedsMarkerTick = true;

                // set the scale for our projection calculations
                S.setScale(this.zoom.max);

                // set center and zoom
                S.centerOn(this.spawn.x, this.spawn.z, this.zoom.def)
                    .setMinZoom(0) // extra zoom out doesn't work :(
                    .setMaxZoom(this.zoom.max + this.zoom.extra);

                // update page title
                document.title =
                    this.type === "normal" ? "Meridian Earth Map" : `${this.display_name} · Meridian Earth Map`;

                // setup background
                document.getElementById("map").style.background = this.getBackground();

                // setup tile layers
                S.layerControl.setupTileLayers(this);
                S.updateDetail();

                // force clear player markers
                S.playerList.clearPlayerMarkers();

                // tick now, reset counter
                S.tick_count = 0;
                S.tick();

                // force clear player markers
                S.playerList.clearPlayerMarkers();

                if (callback != null) {
                    callback(this);
                }
            },
        );
    }
    getBackground() {
        // Meridian: plain black outside the map instead of the sky textures
        return "#000";
    }
    markers(json) {
        // check if json is iterable
        if (json == null || !(Symbol.iterator in Object(json))) {
            return;
        }
        // iterate layers
        for (const entry of json) {
            // check if layer exists and needs updating
            let layer = this.markerLayers.get(entry.id);
            if (layer != null) {
                if (layer.timestamp === entry.timestamp) {
                    continue; // skip
                }
                // clear existing layer to rebuild
                S.layerControl.removeOverlay(layer);
                // TODO
                // implement marker tracker instead of clearing
                // to reduce possible client side lag
            }

            // setup the layer
            layer = new L.LayerGroup();
            layer.order = entry.order;
            layer.id = entry.id;
            layer.timestamp = entry.timestamp;
            layer.setZIndex(entry.z_index);
            this.markerLayers.set(layer.id, layer);

            // setup the layer control
            if (entry.control === true) {
                S.layerControl.addOverlay(entry.name, layer, entry.hide);
            }

            // Meridian: squaremap leaves a shape's outline colour out of markers.json when it's the API default (pure
            // blue), and Leaflet would draw its own light blue instead. A nation coloured #0000ff (Singapore) lost its
            // outline colour that way, and with it the colour of its town icons.
            for (const m of entry.markers) {
                if (m.type !== "icon" && m.color == null) m.color = "#0000ff";
            }

            // Meridian: remember each town's federation colour (its tooltip reads "<b>Federation</b> Town · Nation")
            if (entry.id === "meridian_federations") {
                this.federationColours = new Map();
                for (const m of entry.markers) {
                    const town = (/<span class="muted">([^<·]+)/.exec(m.tooltip || "") || [])[1];
                    if (town && m.color) this.federationColours.set(town.trim(), m.color);
                }
            }
            // Meridian: town icons take their town's claim colour (the nation colour when the town is in a nation)
            if (entry.id === "towny") {
                this.townIcons = new Map();
                S.townPanel?.resetClaims();
                // Meridian: the town search in the side panel
                S.towns?.update(entry.markers);
                const colours = new Map();
                const nameOf = (m) => (/<b>([^<]+)<\/b>/.exec(m.tooltip || "") || [])[1];
                for (const m of entry.markers) {
                    if (m.type === "polygon" && m.color && nameOf(m)) colours.set(nameOf(m), m.color);
                }
                for (const m of entry.markers) {
                    if (m.type === "icon" && colours.has(nameOf(m))) m.tint = colours.get(nameOf(m));
                }
            }

            // setup the markers
            for (const shape in entry.markers) {
                let marker;
                const opts = new Options(entry.markers[shape]);
                // Meridian: a town's land and icons open the town panel instead of MapTowny's popup
                const town =
                    entry.id === "towny" ? (/<b>([^<]+)<\/b>/.exec(entry.markers[shape].tooltip || "") || [])[1] : null;
                if (town && S.townPanel) delete opts.popup;
                switch (opts.pop("type")) {
                    case "rectangle":
                        marker = new Rectangle(opts);
                        break;
                    case "polyline":
                        marker = new PolyLine(opts);
                        break;
                    case "polygon":
                        marker = new Polygon(opts);
                        break;
                    case "circle":
                        marker = new Circle(opts);
                        break;
                    case "ellipse":
                        marker = new Ellipse(opts);
                        break;
                    case "icon":
                        marker = new Icon(opts);
                        if (entry.id === "towny" && marker.tint) {
                            const name = (/<b>([^<]+)<\/b>/.exec(entry.markers[shape].tooltip || "") || [])[1];
                            if (name) {
                                if (!this.townIcons.has(name)) this.townIcons.set(name, []);
                                this.townIcons.get(name).push(marker);
                            }
                        }
                        break;
                }
                if (marker != null) {
                    if (town && S.townPanel) {
                        marker.marker.on("click", (e) => {
                            L.DomEvent.stopPropagation(e);
                            S.townPanel.open(town);
                        });
                        if (marker instanceof Polygon) S.townPanel.addClaim(town, marker.marker);
                    }
                    marker.addTo(layer);
                }
            }
        }
        if (S.townPanel) S.townPanel.applyStyles();
        else this.retintTownIcons();
        if (!this.retintHooked) {
            this.retintHooked = true;
            S.map.on("layeradd layerremove", (e) => {
                if (e.layer && e.layer.id === "meridian_federations") this.retintTownIcons();
            });
        }
        S.globeRenderer?.syncOverlays();
    }
}

export { World };
