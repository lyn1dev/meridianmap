package xyz.jpenilla.squaremap.paper;

import com.google.inject.Inject;
import com.google.inject.Singleton;
import net.kyori.adventure.text.Component;
import net.minecraft.server.level.ServerPlayer;
import org.bukkit.NamespacedKey;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;
import org.checkerframework.checker.nullness.qual.NonNull;
import org.checkerframework.framework.qual.DefaultQualifier;
import xyz.jpenilla.squaremap.common.AbstractPlayerManager;
import xyz.jpenilla.squaremap.common.ServerAccess;

@DefaultQualifier(NonNull.class)
@Singleton
public final class PaperPlayerManager extends AbstractPlayerManager {
    public final NamespacedKey hiddenKey;

    @Inject
    private PaperPlayerManager(
        final JavaPlugin plugin,
        final ServerAccess serverAccess
    ) {
        super(serverAccess);
        this.hiddenKey = new NamespacedKey(plugin, "hidden");
    }

    @Override
    protected boolean persistentHidden(final ServerPlayer player) {
        return pdc(player).getOrDefault(this.hiddenKey, PersistentDataType.BYTE, (byte) 0) != (byte) 0;
    }

    @Override
    protected void persistentHidden(final ServerPlayer player, final boolean value) {
        pdc(player).set(this.hiddenKey, PersistentDataType.BYTE, (byte) (value ? 1 : 0));
    }

    @Override
    public boolean otherwiseHidden(final ServerPlayer player) {
        final org.bukkit.entity.Player bukkit = player.getBukkitEntity();
        return bukkit.hasMetadata("NPC") || vanished(bukkit);
    }

    /** Meridian: the "vanished" metadata vanish plugins set (SuperVanish, PremiumVanish, EssentialsX, Staff++ and others). */
    private static boolean vanished(final org.bukkit.entity.Player player) {
        for (final org.bukkit.metadata.MetadataValue value : player.getMetadata("vanished")) {
            if (value.asBoolean()) {
                return true;
            }
        }
        return false;
    }

    @Override
    public Component displayName(final ServerPlayer player) {
        return player.getBukkitEntity().displayName();
    }

    private static PersistentDataContainer pdc(final ServerPlayer player) {
        return player.getBukkitEntity().getPersistentDataContainer();
    }
}
