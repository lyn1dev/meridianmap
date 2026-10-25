import L from "leaflet";
import { S } from "./Squaremap.js";

/**
 * Meridian: a chunk grid (every 16 blocks, stronger every 512 = region file) as a switchable layer that starts off.
 * Drawn per map tile on a canvas, so it costs nothing until it is switched on and stays light at any zoom. Hidden when
 * chunks would be smaller than MIN_PX on screen (it would just grey the map out).
 */
const MIN_PX = 6;

const Grid = L.GridLayer.extend({
    createTile(coords) {
        const size = this.getTileSize();
        const tile = document.createElement("canvas");
        const ratio = window.devicePixelRatio || 1;
        tile.width = size.x * ratio;
        tile.height = size.y * ratio;
        const ctx = tile.getContext("2d");
        ctx.scale(ratio, ratio);

        const bounds = this._tileCoordsToBounds(coords);
        const nw = S.toPoint(bounds.getNorthWest());
        const se = S.toPoint(bounds.getSouthEast());
        const minX = Math.min(nw.x, se.x), maxX = Math.max(nw.x, se.x);
        const minZ = Math.min(nw.y, se.y), maxZ = Math.max(nw.y, se.y);
        const pxPerBlock = size.x / (maxX - minX);
        if (16 * pxPerBlock < MIN_PX) return tile;

        const line = (step, colour, width) => {
            ctx.strokeStyle = colour;
            ctx.lineWidth = width;
            ctx.beginPath();
            for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
                const px = Math.round((x - minX) * pxPerBlock) + 0.5;
                ctx.moveTo(px, 0);
                ctx.lineTo(px, size.y);
            }
            for (let z = Math.ceil(minZ / step) * step; z <= maxZ; z += step) {
                const py = Math.round((z - minZ) * pxPerBlock) + 0.5;
                ctx.moveTo(0, py);
                ctx.lineTo(size.x, py);
            }
            ctx.stroke();
        };
        line(16, "rgba(255, 255, 255, 0.28)", 1);
        if (512 * pxPerBlock >= MIN_PX) line(512, "rgba(245, 200, 61, 0.7)", 1.5); // region borders, hazard yellow
        return tile;
    },
});

class ChunkGrid {
    constructor() {
        this.layer = new Grid({ pane: "chunkgrid", tileSize: 256, updateWhenZooming: false, keepBuffer: 2 });
        this.layer.id = "chunk_grid";
        this.layer.order = -89; // after country borders, before the marker layers
    }
    /** Called when a world is shown: every world has chunks, so the switch is always there. */
    attach() {
        S.layerControl.removeOverlay(this.layer);
        const pane = S.map.getPane("chunkgrid") || S.map.createPane("chunkgrid");
        pane.style.zIndex = "290"; // above the tiles and relief, under country borders (300) and markers (400)
        pane.style.pointerEvents = "none";
        S.layerControl.addOverlay("Chunk grid", this.layer, true); // off by default; the switch is remembered
    }
}

export { ChunkGrid };
