import { Player } from "./util/Player.js";
import { S } from "./Squaremap.js";
import { plainText } from "./Sidebar.js";

/** Meridian Earth is 133,632 x 55,296 blocks (1:300, 75 N to about 74 S); other worlds get a smaller box around spawn. */
const EARTH = { w: 133632, h: 55296 };

class PlayerList {
    /** @type {Map<string, Player>} */
    players;
    /** @type {Map} */
    markers;
    /** @type {string | null} */
    following;
    /** @type {boolean} */
    firstTick;
    /** @type {PlayersData | null} */
    jsonCache;

    /**
     * @param {Settings_UI_Sidebar} json
     */
    constructor(json) {
        this.players = new Map();
        this.markers = new Map();
        this.jsonCache = null;
        this.following = null;
        this.firstTick = true;
        S.map.createPane("nameplate").style.zIndex = 1000;
    }
    tick() {
        const update = () => {
            this.updatePlayerList(this.jsonCache.players);
            const n = this.jsonCache.players.length;
            const text = `${n} online`;
            if (S.sidebar.players.legend.textContent !== text) {
                S.sidebar.players.legend.textContent = text;
            }
        };
        const fetchPlayers = (callback) => {
            S.getJSON(
                "tiles/players.json",
                /** @param {PlayersData} json */
                (json) => {
                    this.jsonCache = json;
                    callback();
                },
                true,
            );
        };

        if (S.tick_count % S.worldList.curWorld.player_tracker.update_interval === 0) {
            if (S.staticMode && this.jsonCache !== null) {
                update();
            } else {
                fetchPlayers(() => update());
            }
        }
    }
    /**
     * Zoom in close on a visible player, or somewhere random for a hidden one (their position is never sent).
     * @param {string} uuid
     */
    showPlayer(uuid) {
        const player = this.players.get(uuid);
        if (player == null) return false;
        const world = S.worldList.curWorld;
        if (player.hidden) {
            const earth = world.type === "normal";
            const x = earth ? Math.random() * EARTH.w : (Math.random() - 0.5) * 20000;
            const z = earth ? Math.random() * EARTH.h : (Math.random() - 0.5) * 20000;
            S.map.setView(S.toLatLng(x, z), Math.max(0, world.zoom.max - 1));
            return false;
        }
        if (!S.worldList.worlds.has(player.world)) {
            return false;
        }
        S.worldList.showWorld(player.world, () => {
            S.map.setView(S.toLatLng(player.x, player.z), S.worldList.curWorld.zoom.max);
        });
        return true;
    }
    /**
     * @param {Player} player
     */
    addToList(player) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "prow";
        row.id = player.uuid;

        const head = document.createElement("img");
        head.className = "head";
        head.alt = "";
        head.width = 16;
        head.height = 16;
        head.src = player.getHeadUrl();

        const name = document.createElement("span");
        name.className = "pname";
        name.innerHTML = player.displayName;

        const state = document.createElement("span");
        state.className = "pstate";
        state.textContent = "Off map";

        row.append(head, name, state);
        // Meridian: jump to the player once and leave the map alone (no following, nothing stays selected)
        row.addEventListener("click", (e) => {
            e.stopPropagation();
            this.followPlayerMarker(null);
            this.showPlayer(player.uuid);
        });
        this.setRowState(row, player);
        S.sidebar.players.element.appendChild(row);
        this.sortList();
    }
    /**
     * @param {HTMLElement} row
     * @param {Player} player
     */
    setRowState(row, player) {
        row.classList.toggle("is-hidden", player.hidden);
        row.title = player.hidden ? "Hidden from the map (indoors, underground or invisible)" : "Show this player on the map";
        row.dataset.name = `${player.name} ${plainText(player.displayName)}`.toLowerCase();
    }
    sortList() {
        const list = S.sidebar.players.element;
        Array.from(list.children)
            .sort((a, b) => {
                const ha = a.classList.contains("is-hidden"), hb = b.classList.contains("is-hidden");
                if (ha !== hb) return ha ? 1 : -1;
                return a.querySelector(".pname").textContent.localeCompare(b.querySelector(".pname").textContent);
            })
            .forEach((row) => list.appendChild(row));
        S.sidebar.filterPlayers();
    }
    /**
     * @param {Player} player
     */
    removeFromList(player) {
        document.getElementById(player.uuid)?.remove();
        this.players.delete(player.uuid);
        player.removeMarker();
    }
    /**
     * @param {PlayerData[]} players
     */
    updatePlayerList(players) {
        const playersToRemove = Array.from(this.players.keys());
        let needsSort = false;

        for (let i = 0; i < players.length; i++) {
            let player = this.players.get(players[i].uuid);
            if (player == null) {
                player = new Player(players[i]);
                this.players.set(player.uuid, player);
                this.addToList(player);
                player.update(players[i]);
            } else {
                const oldName = player.displayName;
                const oldHidden = player.hidden;
                player.update(players[i]);
                if (oldName !== player.displayName || oldHidden !== player.hidden) {
                    const row = document.getElementById(player.uuid);
                    row.querySelector(".pname").innerHTML = player.displayName;
                    this.setRowState(row, player);
                    needsSort = true;
                }
            }
            playersToRemove.remove(players[i].uuid);
        }

        for (let i = 0; i < playersToRemove.length; i++) {
            this.removeFromList(this.players.get(playersToRemove[i]));
            needsSort = true;
        }
        if (needsSort) {
            this.sortList();
        }
        S.sidebar.filterPlayers();

        if (this.firstTick) {
            this.firstTick = false;
            // a ?uuid= link opens the map on that player once
            const target = S.getUrlParam("uuid", null);
            if (target != null && this.players.get(target) != null && !this.players.get(target).hidden) {
                this.showPlayer(target);
            }
        }

        // follow the highlighted player; stop if they drop off the map
        if (this.following != null) {
            const player = this.players.get(this.following);
            if (player == null || player.hidden) {
                this.followPlayerMarker(null);
            } else if (S.worldList.curWorld != null) {
                if (player.world !== S.worldList.curWorld.name) {
                    S.worldList.showWorld(player.world, () => S.map.panTo(S.toLatLng(player.x, player.z)));
                } else {
                    S.map.panTo(S.toLatLng(player.x, player.z));
                }
            }
        }
    }
    clearPlayerMarkers() {
        for (const player of this.players.values()) {
            player.removeMarker();
        }
        this.markers.clear();
    }
    /**
     * @param {string | null} uuid
     */
    followPlayerMarker(uuid) {
        if (this.following !== null && this.following !== uuid) {
            document.getElementById(this.following)?.classList.remove("following");
        }
        this.following = uuid;
        if (this.following != null) {
            document.getElementById(this.following)?.classList.add("following");
        }
    }
}

export { PlayerList };
