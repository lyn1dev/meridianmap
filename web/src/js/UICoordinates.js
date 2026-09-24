import { S } from "./Squaremap.js";
import L from "leaflet";

/** Meridian Earth projection: 1:300 equirectangular, 371.2 blocks per degree, block z 0 at 75 N and x 0 at 180 W. */
const BLOCKS_PER_DEGREE = 133632 / 360;
const LAT_TOP = 75;

const fmt = (n) => Math.floor(n).toLocaleString("en-US").replace("-", "−");

function latLon(x, z) {
    const lat = LAT_TOP - z / BLOCKS_PER_DEGREE;
    const lon = -180 + x / BLOCKS_PER_DEGREE;
    if (lat > 90 || lat < -90 || lon < -180 || lon > 180) return "";
    const ns = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}`;
    const ew = `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
    return `${ns}  ${ew}`;
}

/** Meridian: where the mouse is, as block coordinates and (on Earth) real latitude and longitude. */
class UICoordinates {
    /**
     * @param {Settings_UI_Coordinates} json
     * @param {boolean} show
     */
    constructor(json, show) {
        const Coords = L.Control.extend({
            options: { position: "bottomleft" },
            onAdd: function () {
                const box = L.DomUtil.create("div", "m-coords");
                box.setAttribute("aria-live", "off");
                this._xz = L.DomUtil.create("span", "xz", box);
                this._ll = L.DomUtil.create("span", "ll", box);
                L.DomEvent.disableClickPropagation(box);
                return box;
            },
            update: function (point) {
                if (point == null) {
                    this._xz.textContent = "X —  Z —";
                    this._ll.textContent = "";
                    return;
                }
                this._xz.textContent = `X ${fmt(point.x)}  Z ${fmt(point.y)}`;
                const earth = S.worldList.curWorld?.type === "normal";
                this._ll.textContent = earth ? latLon(point.x, point.y) : "";
            },
        });
        this.showCoordinates = show;
        this.coords = new Coords();
        S.map.addControl(this.coords);
        S.map.on("mousemove", (event) => {
            if (S.worldList.curWorld != null) {
                this.coords.update(S.toPoint(event.latlng));
            }
        });
        S.map.on("mouseout", () => this.coords.update(null));
        if (!show || !json.enabled) {
            this.coords.getContainer().hidden = true;
        }
        this.coords.update(null);
    }
}

export { UICoordinates };
