package xyz.jpenilla.squaremap.common.config;

import java.util.List;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.Mth;
import xyz.jpenilla.squaremap.common.visibilitylimit.VisibilityShape;
import xyz.jpenilla.squaremap.common.visibilitylimit.WorldBorderShape;

@SuppressWarnings("unused")
public final class WorldConfig extends AbstractWorldConfig<Config> {
    WorldConfig(final Config parent, final ServerLevel world) {
        super(WorldConfig.class, parent, world);
        this.init();
    }

    public boolean MAP_ENABLED = true;
    public String MAP_DISPLAY_NAME = "{world}";
    public int MAP_ORDER = 0;
    public String MAP_ICON = "";
    public int MAX_RENDER_THREADS = -1;
    public boolean MAP_ITERATE_UP = false;
    public int MAP_MAX_HEIGHT = -1;

    private void worldSettings() {
        this.MAP_ENABLED = this.getBoolean("map.enabled", this.MAP_ENABLED);
        this.MAP_DISPLAY_NAME = this.getString("map.display-name", this.MAP_DISPLAY_NAME);
        this.MAP_ORDER = this.getInt("map.order", this.MAP_ORDER);
        this.MAP_ICON = this.getString("map.icon", this.MAP_ICON);
        this.MAX_RENDER_THREADS = this.getInt("map.max-render-threads", this.MAX_RENDER_THREADS);
        this.MAP_ITERATE_UP = this.getBoolean("map.iterate-up", this.MAP_ITERATE_UP);
        this.MAP_MAX_HEIGHT = this.getInt("map.max-height", this.MAP_MAX_HEIGHT);
    }

    public boolean MAP_BIOMES = true;
    public int MAP_BIOMES_BLEND = 3;

    private void biomeSettings() {
        this.MAP_BIOMES = this.getBoolean("map.biomes.enabled", this.MAP_BIOMES);
        this.MAP_BIOMES_BLEND = Mth.clamp(this.getInt("map.biomes.blend-biomes", this.MAP_BIOMES_BLEND), 0, 15);
    }

    public boolean MAP_GLASS_CLEAR = true;

    private void glassSettings() {
        this.MAP_GLASS_CLEAR = this.getBoolean("map.glass.clear", this.MAP_GLASS_CLEAR);
    }

    public boolean MAP_LAVA_CHECKERBOARD = true;

    private void lavaSettings() {
        this.MAP_LAVA_CHECKERBOARD = this.getBoolean("map.lava.checkerboard", this.MAP_LAVA_CHECKERBOARD);
    }

    public boolean MAP_WATER_CLEAR = true;
    public boolean MAP_WATER_CHECKERBOARD = false;

    private void waterSettings() {
        this.MAP_WATER_CLEAR = this.getBoolean("map.water.clear-depth", this.MAP_WATER_CLEAR);
        this.MAP_WATER_CHECKERBOARD = this.getBoolean("map.water.checkerboard", this.MAP_WATER_CHECKERBOARD);
    }

    // Meridian: water shaded smoothly by its real depth (read from the ocean-floor heightmap), replacing
    // clear-depth/checkerboard when enabled
    public boolean MAP_WATER_GRADIENT = true;
    public int MAP_WATER_GRADIENT_DEPTH = 40;

    private void waterGradientSettings() {
        this.MAP_WATER_GRADIENT = this.getBoolean("map.water.gradient.enabled", this.MAP_WATER_GRADIENT);
        this.MAP_WATER_GRADIENT_DEPTH = Math.max(1, this.getInt("map.water.gradient.depth-scale", this.MAP_WATER_GRADIENT_DEPTH));
    }

    // Meridian: block colours averaged from the vanilla textures instead of the map palette
    public boolean MAP_TEXTURE_COLORS = true;
    public double MAP_TINT_BRIGHTNESS = 1.2D;

    private void textureColorSettings() {
        this.MAP_TEXTURE_COLORS = this.getBoolean("map.texture-colors.enabled", this.MAP_TEXTURE_COLORS);
        this.MAP_TINT_BRIGHTNESS = Mth.clamp(this.getDouble("map.texture-colors.tint-brightness", this.MAP_TINT_BRIGHTNESS), 0.5D, 2.0D);
    }

    // Meridian: hill shading rendered as a separate layer the web map can switch on and off
    public boolean MAP_RELIEF = true;
    public double MAP_RELIEF_STRENGTH = 1.0D;
    public double MAP_RELIEF_EXAGGERATION = 1.0D;
    public double MAP_RELIEF_ZOOM_BOOST = 0.5D;
    public double MAP_RELIEF_UNDERWATER = 0.5D;
    public String MAP_RELIEF_LABEL = "Relief";
    public boolean MAP_RELIEF_DEFAULT_HIDDEN = false;
    public String MAP_RELIEF_BLEND_MODE = "soft-light";
    public double MAP_RELIEF_OPACITY = 1.0D;

    private void reliefSettings() {
        this.MAP_RELIEF = this.getBoolean("map.relief.enabled", this.MAP_RELIEF);
        this.MAP_RELIEF_STRENGTH = Mth.clamp(this.getDouble("map.relief.strength", this.MAP_RELIEF_STRENGTH), 0.0D, 3.0D);
        this.MAP_RELIEF_EXAGGERATION = Mth.clamp(this.getDouble("map.relief.exaggeration", this.MAP_RELIEF_EXAGGERATION), 0.1D, 10.0D);
        this.MAP_RELIEF_ZOOM_BOOST = Mth.clamp(this.getDouble("map.relief.zoom-boost", this.MAP_RELIEF_ZOOM_BOOST), 0.0D, 1.0D);
        this.MAP_RELIEF_UNDERWATER = Mth.clamp(this.getDouble("map.relief.underwater", this.MAP_RELIEF_UNDERWATER), 0.0D, 1.0D);
        this.MAP_RELIEF_LABEL = this.getString("map.relief.label", this.MAP_RELIEF_LABEL);
        this.MAP_RELIEF_DEFAULT_HIDDEN = this.getBoolean("map.relief.default-hidden", this.MAP_RELIEF_DEFAULT_HIDDEN);
        this.MAP_RELIEF_BLEND_MODE = this.getString("map.relief.blend-mode", this.MAP_RELIEF_BLEND_MODE);
        this.MAP_RELIEF_OPACITY = Mth.clamp(this.getDouble("map.relief.opacity", this.MAP_RELIEF_OPACITY), 0.0D, 1.0D);
    }

    // Meridian: zoomed-out tiles average each block of pixels instead of picking one (no aliasing at country scale)
    public boolean ZOOM_SMOOTH = true;

    private void zoomSmoothSettings() {
        this.ZOOM_SMOOTH = this.getBoolean("map.zoom.smooth-zoom-out", this.ZOOM_SMOOTH);
    }

    public int ZOOM_MAX = 3;
    public int ZOOM_DEFAULT = 3;
    public int ZOOM_EXTRA = 2;

    private void zoomSettings() {
        this.ZOOM_MAX = this.getInt("map.zoom.maximum", this.ZOOM_MAX);
        this.ZOOM_DEFAULT = this.getInt("map.zoom.default", this.ZOOM_DEFAULT);
        this.ZOOM_EXTRA = this.getInt("map.zoom.extra", this.ZOOM_EXTRA);
    }

    public boolean BACKGROUND_RENDER_ENABLED = true;
    public int BACKGROUND_RENDER_MAX_CHUNKS_PER_INTERVAL = 1024;
    public int BACKGROUND_RENDER_INTERVAL_SECONDS = 15;
    public int BACKGROUND_RENDER_MAX_THREADS = -1;

    private void backgroundRenderSettings() {
        this.BACKGROUND_RENDER_ENABLED = this.getBoolean("map.background-render.enabled", this.BACKGROUND_RENDER_ENABLED);
        this.BACKGROUND_RENDER_MAX_CHUNKS_PER_INTERVAL = this.getInt("map.background-render.max-chunks-per-interval", this.BACKGROUND_RENDER_MAX_CHUNKS_PER_INTERVAL);
        this.BACKGROUND_RENDER_INTERVAL_SECONDS = this.getInt("map.background-render.interval-seconds", this.BACKGROUND_RENDER_INTERVAL_SECONDS);
        this.BACKGROUND_RENDER_MAX_THREADS = this.getInt("map.background-render.max-render-threads", this.BACKGROUND_RENDER_MAX_THREADS);
    }

    public boolean PLAYER_TRACKER_ENABLED = true;
    public int PLAYER_TRACKER_UPDATE_INTERVAL = 1;
    public boolean PLAYER_TRACKER_SHOW_CONTROLS = true;
    public boolean PLAYER_TRACKER_DEFAULT_HIDDEN = false;
    public int PLAYER_TRACKER_PRIORITY = 2;
    public int PLAYER_TRACKER_Z_INDEX = 2;
    public boolean PLAYER_TRACKER_NAMEPLATE_ENABLED = true;
    public boolean PLAYER_TRACKER_NAMEPLATE_SHOW_HEAD = true;
    public String PLAYER_TRACKER_NAMEPLATE_HEADS_URL = "https://mc-heads.net/avatar/{uuid}/16";
    public boolean PLAYER_TRACKER_NAMEPLATE_SHOW_ARMOR = true;
    public boolean PLAYER_TRACKER_NAMEPLATE_SHOW_HEALTH = true;
    public boolean PLAYER_TRACKER_HIDE_INVISIBLE = true;
    public boolean PLAYER_TRACKER_HIDE_SPECTATORS = true;
    public boolean PLAYER_TRACKER_HIDE_MAP_INVISIBILITY_EQUIPMENT = true;
    public boolean PLAYER_TRACKER_USE_DISPLAY_NAME = false;

    private void playerTrackerSettings() {
        this.PLAYER_TRACKER_ENABLED = this.getBoolean("player-tracker.enabled", this.PLAYER_TRACKER_ENABLED);
        this.PLAYER_TRACKER_UPDATE_INTERVAL = this.getInt("player-tracker.update-interval-seconds", this.PLAYER_TRACKER_UPDATE_INTERVAL);
        this.PLAYER_TRACKER_SHOW_CONTROLS = this.getBoolean("player-tracker.show-controls", this.PLAYER_TRACKER_SHOW_CONTROLS);
        this.PLAYER_TRACKER_DEFAULT_HIDDEN = this.getBoolean("player-tracker.default-hidden", this.PLAYER_TRACKER_DEFAULT_HIDDEN);
        this.PLAYER_TRACKER_PRIORITY = this.getInt("player-tracker.layer-priority", this.PLAYER_TRACKER_PRIORITY);
        this.PLAYER_TRACKER_Z_INDEX = this.getInt("player-tracker.z-index", this.PLAYER_TRACKER_Z_INDEX);
        this.PLAYER_TRACKER_NAMEPLATE_ENABLED = this.getBoolean("player-tracker.nameplate.enabled", this.PLAYER_TRACKER_NAMEPLATE_ENABLED);
        this.PLAYER_TRACKER_NAMEPLATE_SHOW_HEAD = this.getBoolean("player-tracker.nameplate.show-head", this.PLAYER_TRACKER_NAMEPLATE_SHOW_HEAD);
        this.PLAYER_TRACKER_NAMEPLATE_HEADS_URL = this.getString("player-tracker.nameplate.heads-url", this.PLAYER_TRACKER_NAMEPLATE_HEADS_URL);
        this.PLAYER_TRACKER_NAMEPLATE_SHOW_ARMOR = this.getBoolean("player-tracker.nameplate.show-armor", this.PLAYER_TRACKER_NAMEPLATE_SHOW_ARMOR);
        this.PLAYER_TRACKER_NAMEPLATE_SHOW_HEALTH = this.getBoolean("player-tracker.nameplate.show-health", this.PLAYER_TRACKER_NAMEPLATE_SHOW_HEALTH);
        this.PLAYER_TRACKER_HIDE_INVISIBLE = this.getBoolean("player-tracker.hide.invisible", this.PLAYER_TRACKER_HIDE_INVISIBLE);
        this.PLAYER_TRACKER_HIDE_SPECTATORS = this.getBoolean("player-tracker.hide.spectators", this.PLAYER_TRACKER_HIDE_SPECTATORS);
        this.PLAYER_TRACKER_HIDE_MAP_INVISIBILITY_EQUIPMENT = this.getBoolean("player-tracker.hide.map-invisibility-equipment", this.PLAYER_TRACKER_HIDE_MAP_INVISIBILITY_EQUIPMENT);
        this.PLAYER_TRACKER_USE_DISPLAY_NAME = this.getBoolean("player-tracker.use-display-names", this.PLAYER_TRACKER_USE_DISPLAY_NAME);
    }

    public int MARKER_API_UPDATE_INTERVAL_SECONDS = 5;

    private void markerSettings() {
        this.MARKER_API_UPDATE_INTERVAL_SECONDS = this.getInt("map.markers.update-interval-seconds", this.MARKER_API_UPDATE_INTERVAL_SECONDS);
    }

    public boolean SPAWN_MARKER_ICON_ENABLED = true;
    public boolean SPAWN_MARKER_ICON_SHOW_CONTROLS = true;
    public boolean SPAWN_MARKER_ICON_DEFAULT_HIDDEN = false;
    public int SPAWN_MARKER_ICON_LAYER_PRIORITY = 0;
    public int SPAWN_MARKER_ICON_Z_INDEX = 0;

    private void spawnMarkerSettings() {
        this.SPAWN_MARKER_ICON_ENABLED = this.getBoolean("map.markers.spawn-icon.enabled", this.SPAWN_MARKER_ICON_ENABLED);
        this.SPAWN_MARKER_ICON_SHOW_CONTROLS = this.getBoolean("map.markers.spawn-icon.show-controls", this.SPAWN_MARKER_ICON_SHOW_CONTROLS);
        this.SPAWN_MARKER_ICON_DEFAULT_HIDDEN = this.getBoolean("map.markers.spawn-icon.default-hidden", this.SPAWN_MARKER_ICON_DEFAULT_HIDDEN);
        this.SPAWN_MARKER_ICON_LAYER_PRIORITY = this.getInt("map.markers.spawn-icon.layer-priority", this.SPAWN_MARKER_ICON_LAYER_PRIORITY);
        this.SPAWN_MARKER_ICON_Z_INDEX = this.getInt("map.markers.spawn-icon.z-index", this.SPAWN_MARKER_ICON_Z_INDEX);
    }

    public boolean WORLDBORDER_MARKER_ENABLED = true;
    public boolean WORLDBORDER_MARKER_SHOW_CONTROLS = true;
    public boolean WORLDBORDER_MARKER_DEFAULT_HIDDEN = false;
    public int WORLDBORDER_MARKER_LAYER_PRIORITY = 1;
    public int WORLDBORDER_MARKER_Z_INDEX = 1;

    private void worldborderMarkerSettings() {
        this.WORLDBORDER_MARKER_ENABLED = this.getBoolean("map.markers.world-border.enabled", this.WORLDBORDER_MARKER_ENABLED);
        this.WORLDBORDER_MARKER_SHOW_CONTROLS = this.getBoolean("map.markers.world-border.show-controls", this.WORLDBORDER_MARKER_SHOW_CONTROLS);
        this.WORLDBORDER_MARKER_DEFAULT_HIDDEN = this.getBoolean("map.markers.world-border.default-hidden", this.WORLDBORDER_MARKER_DEFAULT_HIDDEN);
        this.WORLDBORDER_MARKER_LAYER_PRIORITY = this.getInt("map.markers.world-border.layer-priority", this.WORLDBORDER_MARKER_LAYER_PRIORITY);
        this.WORLDBORDER_MARKER_Z_INDEX = this.getInt("map.markers.world-border.z-index", this.WORLDBORDER_MARKER_Z_INDEX);
    }

    public List<VisibilityShape> VISIBILITY_LIMITS = List.of(new WorldBorderShape());

    private void visibilityLimitSettings() {
        this.VISIBILITY_LIMITS = this.getList(VisibilityShape.class, "map.visibility-limits", this.VISIBILITY_LIMITS);
    }
}
