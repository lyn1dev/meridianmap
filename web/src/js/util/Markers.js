import { S } from "../Squaremap.js";
import L from "leaflet";

class Marker {
    /** @type {L.Marker} */
    marker;
    opts;
    id;
    popup;
    /** @type {boolean} */
    popup_sticky;
    tooltip;
    /** @type {boolean} */
    tooltip_sticky;

    constructor(opts) {
        this.opts = opts;
        this.id = this.opts.pop("id");
        this.popup = this.opts.pop("popup");
        this.popup_sticky = true;
        this.tooltip = this.opts.pop("tooltip");
        this.tooltip_sticky = true;
    }
    init() {
        if (this.popup != null) {
            if (this.popup_sticky) {
                this.marker.on("click", () => {
                    L.popup({
                        className: "m-popup",
                        direction: this.opts.pop("tooltip_direction", "top"),
                    })
                        .setLatLng(S.toLatLng(S.coordinates.coords.x, S.coordinates.coords.z))
                        .setContent(this.popup)
                        .openOn(S.map);
                });
            } else {
                this.marker.bindPopup(() => this.popup, {
                    className: "m-popup",
                    direction: this.opts.pop("tooltip_direction", "top"),
                });
            }
        }
        if (this.tooltip != null) {
            this.marker.bindTooltip(() => this.tooltip, {
                direction: this.opts.pop("tooltip_direction", "top"),
                sticky: this.tooltip_sticky,
            });
        }
        for (const key in this.opts) {
            this.marker.options[key] = this.opts[key];
        }
    }
    addTo(layer) {
        this.marker.remove();
        this.marker.addTo(layer);
    }
}

class Options {
    constructor(json) {
        for (const prop in json) {
            this[prop] = json[prop];
        }
    }
    pop(key, def) {
        const val = this[key];
        delete this[key];
        return val == null ? def : val;
    }
}

class Rectangle extends Marker {
    constructor(opts) {
        super(opts);
        const points = this.opts.pop("points");
        this.marker = L.rectangle([S.toLatLng(points[0].x, points[0].z), S.toLatLng(points[1].x, points[1].z)]);
        super.init();
    }
}

class PolyLine extends Marker {
    constructor(opts) {
        super(opts);
        const points = this.opts.pop("points");
        const outer = [];
        for (let i = 0; i < points.length; i++) {
            if (Symbol.iterator in Object(points[i])) {
                const inner = [];
                for (let j = 0; j < points[i].length; j++) {
                    inner.push(S.toLatLng(points[i][j].x, points[i][j].z));
                }
                outer.push(inner);
            } else {
                outer.push(S.toLatLng(points[i].x, points[i].z));
            }
        }
        this.marker = L.polyline(outer);
        super.init();
    }
}

class Polygon extends Marker {
    constructor(opts) {
        super(opts);
        const points = this.opts.pop("points");
        const outer = [];
        for (let i = 0; i < points.length; i++) {
            if (Symbol.iterator in Object(points[i])) {
                const inner = [];
                for (let j = 0; j < points[i].length; j++) {
                    if (Symbol.iterator in Object(points[i][j])) {
                        const inner2 = [];
                        for (let k = 0; k < points[i][j].length; k++) {
                            inner2.push(S.toLatLng(points[i][j][k].x, points[i][j][k].z));
                        }
                        inner.push(inner2);
                    } else {
                        inner.push(S.toLatLng(points[i][j].x, points[i][j].z));
                    }
                }
                outer.push(inner);
            } else {
                outer.push(S.toLatLng(points[i].x, points[i].z));
            }
        }
        this.marker = L.polygon(outer);
        super.init();
    }
}

class Circle extends Marker {
    constructor(opts) {
        super(opts);
        const center = this.opts.pop("center");
        const radius = this.opts.pop("radius");
        this.marker = L.circle(S.toLatLng(center.x, center.z), {
            radius: S.pixelsToMeters(radius),
        });
        super.init();
    }
}

class Ellipse extends Marker {
    constructor(opts) {
        super(opts);
        const center = this.opts.pop("center");
        const radiusX = this.opts.pop("radiusX");
        const radiusZ = this.opts.pop("radiusZ");
        const tilt = 0;
        this.marker = L.ellipse(S.toLatLng(center.x, center.z), [radiusX, radiusZ], tilt);
        super.init();
    }
}

// Meridian: MapTowny's town, capital and outpost icons, drawn in the town's colour (its nation's, or hazard yellow)
const DARK = "#0b0f1a";
function townIcon(key, c) {
    const wrap = (inner) => `<svg viewBox="0 0 18 18" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    if (key.includes("capital")) {
        return wrap(`<circle cx="9" cy="9" r="8.2" fill="${c}" stroke="${DARK}" stroke-width="0.8"/>`
            + `<path d="M9 3.6l1.55 3.4 3.7.35-2.8 2.45.85 3.65L9 11.55 5.7 13.45l.85-3.65-2.8-2.45 3.7-.35z" fill="${DARK}"/>`);
    }
    if (key.includes("outpost")) {
        return wrap(`<circle cx="9" cy="9" r="6.4" fill="${DARK}" stroke="${c}" stroke-width="3"/>`
            + `<circle cx="9" cy="9" r="7.9" fill="none" stroke="${DARK}" stroke-width="0.8"/>`);
    }
    return wrap(`<path d="M9 .8L17.2 9 9 17.2.8 9z" fill="${c}" stroke="${DARK}" stroke-width="0.8"/>`
        + `<path d="M9 4.2L13.8 9 9 13.8 4.2 9z" fill="${DARK}"/>`
        + `<path d="M9 6.9L11.1 9 9 11.1 6.9 9z" fill="${c}"/>`);
}

class Icon extends Marker {
    constructor(opts) {
        super(opts);
        const point = this.opts.pop("point");
        const size = this.opts.pop("size");
        const anchor = this.opts.pop("anchor");
        const tooltipAnchor = this.opts.pop("tooltip_anchor", L.point(0, -size.z / 2));
        const key = opts.pop("icon");
        const tint = opts.pop("tint");
        const svg = tint ? townIcon(key, tint) : null;
        const common = {
            iconSize: [size.x, size.z],
            iconAnchor: [anchor.x, anchor.z],
            popupAnchor: [tooltipAnchor.x, tooltipAnchor.z],
            tooltipAnchor: [tooltipAnchor.x, tooltipAnchor.z],
        };
        this.marker = L.marker(S.toLatLng(point.x, point.z), {
            icon: svg
                ? L.divIcon({ ...common, html: svg, className: "town-icon" })
                : L.icon({ ...common, iconUrl: `images/icon/registered/${key}.png` }),
        });
        this.key = key;
        this.common = common;
        this.tint = tint;
        this.popup_sticky = false;
        this.tooltip_sticky = false;
        super.init();
    }
    /** Redraw a town icon in another colour (the federation colour while that overlay is on). */
    retint(colour) {
        if (!this.tint) return;
        this.marker.setIcon(L.divIcon({ ...this.common, html: townIcon(this.key, colour || this.tint), className: "town-icon" }));
    }
}

export { Marker, Options, Rectangle, PolyLine, Polygon, Circle, Ellipse, Icon };
