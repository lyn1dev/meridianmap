import { S } from "./Squaremap.js";
import L from "leaflet";

/** "Copy link" button next to the coordinates: copies a URL that opens the map on the current view. */
class UILink {
    /**
     * @param {Settings_UI_Link} json
     * @param {boolean} show
     */
    constructor(json, show) {
        const Link = L.Control.extend({
            options: { position: "bottomleft" },
            onAdd: function () {
                const button = L.DomUtil.create("button", "m-link");
                button.type = "button";
                button.textContent = "Copy link";
                button.title = "Copy a link to this view";
                L.DomEvent.disableClickPropagation(button);
                button.addEventListener("click", async () => {
                    const url = S.worldList.curWorld == null ? "" : S.getUrlFromView();
                    window.history.replaceState(null, "", url);
                    try {
                        await navigator.clipboard.writeText(window.location.href);
                        button.textContent = "Copied";
                    } catch {
                        button.textContent = "Link in address bar";
                    }
                    setTimeout(() => (button.textContent = "Copy link"), 1800);
                });
                return button;
            },
        });
        this.showLinkButton = show;
        this.link = new Link();
        S.map.addControl(this.link);
        if (!show || !json.enabled) {
            this.link.getContainer().hidden = true;
        }
    }
}

export { UILink };
