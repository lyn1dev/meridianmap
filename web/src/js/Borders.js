import L from "leaflet";
import { S } from "./Squaremap.js";

/**
 * Meridian: real-world country borders over the Earth map, as a switchable layer that starts on.
 * borders.json holds Natural Earth's 1:10m land borders already in block coordinates (see noah/servers/borders/),
 * so it is fetched once and never polled like the marker layers.
 */
const URL = "borders.json";
const WORLD = "minecraft_overworld";

class Borders {
    constructor() {
        this.layer = new L.LayerGroup();
        this.layer.id = "country_borders";
        this.layer.order = -90; // just after relief, before the marker layers
        /** @type {{solid: number[][], dashed: number[][]} | null} */
        this.data = null;
        this.drawn = false;
        fetch(URL)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((json) => {
                this.data = json;
                this.draw();
            })
            .catch(() => {
                // no borders file: the layer just stays empty
            });
    }
    /** Called when a world is shown: borders belong to the overworld only. */
    attach() {
        S.layerControl.removeOverlay(this.layer);
        if (S.worldList?.curWorld?.name !== WORLD) return;
        S.layerControl.addOverlay("Country borders", this.layer, false);
        this.draw();
    }
    draw() {
        if (this.drawn || this.data == null || S.map == null) return;
        const pane = S.map.getPane("borders") || S.map.createPane("borders");
        pane.style.zIndex = "300"; // above the tiles and relief (250), under towns and other markers (400)
        pane.style.pointerEvents = "none";
        const renderer = L.canvas({ pane: "borders", padding: 0.5 });
        const toLines = (flat) =>
            flat.map((line) => {
                const pts = [];
                for (let i = 0; i + 1 < line.length; i += 2) pts.push(S.toLatLng(line[i], line[i + 1]));
                return pts;
            });
        const common = { renderer, pane: "borders", interactive: false, color: "#ffffff", lineCap: "round", lineJoin: "round" };
        L.polyline(toLines(this.data.solid || []), { ...common, weight: 1.6, opacity: 0.6 }).addTo(this.layer);
        // disputed, indefinite and line-of-control borders
        L.polyline(toLines(this.data.dashed || []), { ...common, weight: 1.4, opacity: 0.5, dashArray: "5 5" }).addTo(this.layer);
        this.drawn = true;
    }
}

export { Borders };
