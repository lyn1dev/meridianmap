package xyz.jpenilla.squaremap.common.task;

import com.google.inject.Inject;
import com.google.inject.Provider;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ForkJoinPool;
import net.kyori.adventure.text.flattener.ComponentFlattener;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.BlockTags;
import net.minecraft.tags.ItemTags;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.phys.Vec3;
import org.checkerframework.checker.nullness.qual.NonNull;
import org.checkerframework.checker.nullness.qual.Nullable;
import org.checkerframework.framework.qual.DefaultQualifier;
import xyz.jpenilla.squaremap.api.HtmlComponentSerializer;
import xyz.jpenilla.squaremap.common.AbstractPlayerManager;
import xyz.jpenilla.squaremap.common.ServerAccess;
import xyz.jpenilla.squaremap.common.config.ConfigManager;
import xyz.jpenilla.squaremap.common.config.WorldConfig;
import xyz.jpenilla.squaremap.common.httpd.JsonCache;
import xyz.jpenilla.squaremap.common.util.Util;

@DefaultQualifier(NonNull.class)
public final class UpdatePlayers implements Runnable {
    private static final String JSON_PATH = "/tiles/players.json";

    private final Provider<ComponentFlattener> flattener;
    private final AbstractPlayerManager playerManager;
    private final ServerAccess serverAccess;
    private final ConfigManager configManager;
    private final JsonCache jsonCache;
    private @Nullable Map<String, Object> lastData = null;

    @Inject
    private UpdatePlayers(
        final Provider<ComponentFlattener> flattener,
        final AbstractPlayerManager playerManager,
        final ServerAccess serverAccess,
        final ConfigManager configManager,
        final JsonCache jsonCache
    ) {
        this.flattener = flattener;
        this.playerManager = playerManager;
        this.serverAccess = serverAccess;
        this.configManager = configManager;
        this.jsonCache = jsonCache;
    }

    @Override
    public void run() {
        final @Nullable Map<String, Object> prev = this.lastData;
        final Map<String, Object> data = this.collectData();
        this.lastData = data;

        ForkJoinPool.commonPool().execute(() -> {
            if (prev == null || !prev.equals(data)) {
                final String json = Util.gson().toJson(data);
                this.jsonCache.put(JSON_PATH, json);
            }
        });
    }

    private Map<String, Object> collectData() {
        final List<Object> players = new ArrayList<>();

        final HtmlComponentSerializer htmlComponentSerializer = HtmlComponentSerializer.withFlattener(this.flattener.get());

        this.serverAccess.levels().forEach(world -> {
            final WorldConfig worldConfig = this.configManager.worldConfig(world);

            world.players().forEach(player -> {
                // left out entirely (vanished staff, spectators, NPCs): not even their name is published
                if (worldConfig.PLAYER_TRACKER_HIDE_SPECTATORS && player.gameMode.getGameModeForPlayer() == GameType.SPECTATOR) {
                    return;
                }
                if (this.playerManager.otherwiseHidden(player)) {
                    return;
                }
                // Meridian: hidden from the map (invisible, under a roof, /map hide) but still listed, with no position
                final boolean hidden = (worldConfig.PLAYER_TRACKER_HIDE_INVISIBLE && player.isInvisible())
                    || (worldConfig.PLAYER_TRACKER_HIDE_MAP_INVISIBILITY_EQUIPMENT && hasMapInvisibilityItemEquipped(player))
                    || (worldConfig.PLAYER_TRACKER_HIDE_UNDER_ROOF && underRoof(world, player))
                    || this.playerManager.hidden(player);
                if (hidden) {
                    if (worldConfig.PLAYER_TRACKER_LIST_HIDDEN) {
                        final Map<String, Object> entry = new HashMap<>();
                        entry.put("name", player.getGameProfile().name());
                        if (worldConfig.PLAYER_TRACKER_USE_DISPLAY_NAME) {
                            entry.put("display_name", htmlComponentSerializer.serialize(this.playerManager.displayName(player)));
                        }
                        entry.put("uuid", player.getUUID().toString().replace("-", ""));
                        entry.put("hidden", true);
                        players.add(entry);
                    }
                    return;
                }
                final Map<String, Object> playerEntry = new HashMap<>();
                final Vec3 playerLoc = player.position();
                playerEntry.put("name", player.getGameProfile().name());
                if (worldConfig.PLAYER_TRACKER_USE_DISPLAY_NAME) {
                    playerEntry.put("display_name", htmlComponentSerializer.serialize(this.playerManager.displayName(player)));
                }
                playerEntry.put("uuid", player.getUUID().toString().replace("-", ""));
                playerEntry.put("world", Util.levelWebName(world));
                if (worldConfig.PLAYER_TRACKER_ENABLED) {
                    playerEntry.put("x", Mth.floor(playerLoc.x()));
                    playerEntry.put("y", Mth.floor(playerLoc.y()));
                    playerEntry.put("z", Mth.floor(playerLoc.z()));
                    playerEntry.put("yaw", Math.round(player.getYHeadRot()));
                    if (worldConfig.PLAYER_TRACKER_NAMEPLATE_SHOW_ARMOR) {
                        playerEntry.put("armor", armorPoints(player));
                    }
                    if (worldConfig.PLAYER_TRACKER_NAMEPLATE_SHOW_HEALTH) {
                        playerEntry.put("health", (int) player.getHealth());
                    }
                }
                players.add(playerEntry);
            });
        });

        final Map<String, Object> map = new HashMap<>();

        map.put("players", players);
        map.put("max", this.serverAccess.maxPlayers());

        return map;
    }

    /**
     * Meridian: is there a solid block anywhere above the player's head? Leaves, water and plants don't count, so
     * standing under a tree or swimming keeps you on the map; a roof, a cave or an overhang hides you.
     */
    private static boolean underRoof(final ServerLevel level, final ServerPlayer player) {
        final BlockPos head = BlockPos.containing(player.getEyePosition());
        final int top = level.getHeight(Heightmap.Types.MOTION_BLOCKING, head.getX(), head.getZ());
        final BlockPos.MutableBlockPos pos = head.mutable();
        for (int y = head.getY() + 1; y < top; y++) {
            pos.setY(y);
            final BlockState state = level.getBlockState(pos);
            if (state.isAir() || state.is(BlockTags.LEAVES)) {
                continue;
            }
            if (state.blocksMotion()) {
                return true;
            }
        }
        return false;
    }

    private static int armorPoints(final ServerPlayer player) {
        final @Nullable AttributeInstance attribute = player.getAttribute(Attributes.ARMOR);
        return attribute == null ? 0 : (int) attribute.getValue();
    }

    // Copied from MapItemSavedData#hasMapInvisibilityItemEquipped(Player)
    private static boolean hasMapInvisibilityItemEquipped(final Player player) {
        for (final EquipmentSlot slot : EquipmentSlot.values()) {
            if (slot != EquipmentSlot.MAINHAND && slot != EquipmentSlot.OFFHAND && player.getItemBySlot(slot).is(ItemTags.MAP_INVISIBILITY_EQUIPMENT)) {
                return true;
            }
        }
        return false;
    }
}
