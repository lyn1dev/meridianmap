package xyz.jpenilla.squaremap.paper.meridian;

import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ForkJoinPool;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.EnchantmentStorageMeta;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.plugin.Plugin;
import org.checkerframework.checker.nullness.qual.NonNull;
import org.checkerframework.checker.nullness.qual.Nullable;
import org.checkerframework.framework.qual.DefaultQualifier;
import xyz.jpenilla.squaremap.common.Logging;
import xyz.jpenilla.squaremap.common.util.Util;

/**
 * Meridian: every QuickShop-Hikari chest shop on this server, written to {@code tiles/shops.json} in the web folder for
 * the map's shop search. Same fields as the stats site's market. QuickShop and Towny are reached through their own class
 * loaders, so neither is a build or load-order dependency; without QuickShop the file simply lists no shops.
 */
@DefaultQualifier(NonNull.class)
public final class ShopExport implements Runnable {
    private final Path file;
    private boolean warned;

    public ShopExport(final Path webDirectory) {
        this.file = webDirectory.resolve("tiles").resolve("shops.json");
    }

    /** Collects on the calling (main) thread, writes the file in the background. */
    @Override
    public void run() {
        final List<Map<String, Object>> shops = this.collect();
        final Map<String, Object> wrapped = new LinkedHashMap<>();
        wrapped.put("generated", System.currentTimeMillis());
        wrapped.put("data", shops);
        final String json = Util.gson().toJson(wrapped);
        ForkJoinPool.commonPool().execute(() -> {
            try {
                Files.createDirectories(this.file.getParent());
                final Path tmp = this.file.resolveSibling("shops.json.tmp");
                Files.writeString(tmp, json, StandardCharsets.UTF_8);
                Files.move(tmp, this.file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (final IOException e) {
                Logging.logger().warn("Could not write shops.json", e);
            }
        });
    }

    private List<Map<String, Object>> collect() {
        final List<Map<String, Object>> list = new ArrayList<>();
        final @Nullable Plugin qs = Bukkit.getPluginManager().getPlugin("QuickShop-Hikari");
        if (qs == null || !qs.isEnabled()) {
            return list;
        }
        try {
            final ClassLoader cl = qs.getClass().getClassLoader();
            final Class<?> apiClass = Class.forName("com.ghostchu.quickshop.api.QuickShopAPI", true, cl);
            final Class<?> shopClass = Class.forName("com.ghostchu.quickshop.api.shop.Shop", true, cl);
            final Object api = apiClass.getMethod("getInstance").invoke(null);
            final Object manager = api.getClass().getMethod("getShopManager").invoke(api);
            final Collection<?> all = (Collection<?>) manager.getClass().getMethod("getAllShops").invoke(manager);
            final Method price = shopClass.getMethod("getPrice");
            final Method item = shopClass.getMethod("getItem");
            final Method stacking = shopClass.getMethod("getShopStackingAmount");
            final Method buying = shopClass.getMethod("isBuying");
            final Method owner = shopClass.getMethod("getOwner");
            final Method location = locationMethod(shopClass);
            final Method stock = shopClass.getMethod("getRemainingStock");
            final Method space = shopClass.getMethod("getRemainingSpace");
            for (final Object shop : all) {
                final @Nullable Location l = (Location) location.invoke(shop);
                if (l == null || l.getWorld() == null) {
                    continue;
                }
                final ItemStack stack = (ItemStack) item.invoke(shop);
                final boolean isBuying = (boolean) buying.invoke(shop);
                final Map<String, Object> m = new LinkedHashMap<>();
                m.put("item", stack.getType().getKey().getKey());
                m.put("amount", stacking.invoke(shop));
                final @Nullable ItemMeta meta = stack.hasItemMeta() ? stack.getItemMeta() : null;
                if (meta != null && meta.hasDisplayName() && meta.displayName() != null) {
                    m.put("itemName", PlainTextComponentSerializer.plainText().serialize(meta.displayName()));
                }
                final List<String> enchants = new ArrayList<>();
                if (meta instanceof EnchantmentStorageMeta esm) {
                    esm.getStoredEnchants().forEach((e, lvl) -> enchants.add(e.getKey().getKey() + " " + lvl));
                } else {
                    stack.getEnchantments().forEach((e, lvl) -> enchants.add(e.getKey().getKey() + " " + lvl));
                }
                if (!enchants.isEmpty()) {
                    m.put("enchants", enchants);
                }
                m.put("price", price.invoke(shop));
                m.put("type", isBuying ? "buying" : "selling");
                m.put("owner", ownerName(owner.invoke(shop)));
                m.put("world", l.getWorld().getName());
                m.put("x", l.getBlockX());
                m.put("y", l.getBlockY());
                m.put("z", l.getBlockZ());
                m.put("town", townName(l));
                if (l.isChunkLoaded()) {
                    try {
                        m.put("stock", (isBuying ? space : stock).invoke(shop));
                    } catch (final ReflectiveOperationException ignored) {
                    }
                }
                list.add(m);
            }
        } catch (final ReflectiveOperationException | ClassCastException | LinkageError e) {
            if (!this.warned) {
                this.warned = true;
                Logging.logger().warn("Could not read QuickShop shops for the map: {}", e.toString());
            }
        }
        return list;
    }

    /** QuickShop 6 names it bukkitLocation(); older builds used getLocation(). */
    private static Method locationMethod(final Class<?> shopClass) throws NoSuchMethodException {
        try {
            return shopClass.getMethod("bukkitLocation");
        } catch (final NoSuchMethodException e) {
            return shopClass.getMethod("getLocation");
        }
    }

    private static @Nullable String ownerName(final @Nullable Object owner) {
        if (owner == null) {
            return null;
        }
        try {
            return String.valueOf(owner.getClass().getMethod("getDisplay").invoke(owner));
        } catch (final ReflectiveOperationException e) {
            return null;
        }
    }

    private static @Nullable String townName(final Location l) {
        final @Nullable Plugin towny = Bukkit.getPluginManager().getPlugin("Towny");
        if (towny == null || !towny.isEnabled()) {
            return null;
        }
        try {
            final Class<?> api = Class.forName("com.palmergames.bukkit.towny.TownyAPI", true, towny.getClass().getClassLoader());
            final Object inst = api.getMethod("getInstance").invoke(null);
            final @Nullable Object town = api.getMethod("getTown", Location.class).invoke(inst, l);
            return town == null ? null : String.valueOf(town.getClass().getMethod("getName").invoke(town));
        } catch (final ReflectiveOperationException e) {
            return null;
        }
    }
}
