package xyz.jpenilla.squaremap.common.data;

import java.awt.Color;
import java.awt.Transparency;
import java.awt.color.ColorSpace;
import java.awt.image.BufferedImage;
import java.awt.image.ComponentColorModel;
import java.awt.image.DataBuffer;
import java.awt.image.Raster;
import java.awt.image.WritableRaster;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import net.minecraft.util.Mth;
import org.checkerframework.checker.nullness.qual.NonNull;
import org.checkerframework.checker.nullness.qual.Nullable;
import org.checkerframework.framework.qual.DefaultQualifier;
import xyz.jpenilla.squaremap.common.Logging;
import xyz.jpenilla.squaremap.common.config.Config;
import xyz.jpenilla.squaremap.common.config.Messages;
import xyz.jpenilla.squaremap.common.config.WorldConfig;
import xyz.jpenilla.squaremap.common.util.FileUtil;

@DefaultQualifier(NonNull.class)
public final class Image {
    private static final int TRANSPARENT = new Color(0, 0, 0, 0).getRGB();
    public static final int SIZE = 512;
    /**
     * Meridian: relief tiles are grey + alpha; this grey leaves the colour underneath unchanged, and pixels with
     * nothing rendered under them are fully transparent (a blend over empty map would show the grey itself).
     */
    private static final int RELIEF_NEUTRAL = 128;
    private static final ComponentColorModel RELIEF_COLOR_MODEL = new ComponentColorModel(
        ColorSpace.getInstance(ColorSpace.CS_GRAY), true, false, Transparency.TRANSLUCENT, DataBuffer.TYPE_BYTE);
    /** Sun in the north-west, 45 degrees up (the cartographic convention). */
    private static final double SUN_ZENITH = Math.toRadians(45.0D);
    private static final double SUN_AZIMUTH = Math.toRadians(360.0D - 315.0D + 90.0D);

    private final RegionCoordinate region;
    private final Path directory;
    private final int maxZoom;
    private final @Nullable WorldConfig config;
    private int @Nullable [][] pixels = null;
    private int @Nullable [][] heights = null;

    public Image(final RegionCoordinate region, final Path directory, final int maxZoom) {
        this(region, directory, maxZoom, null);
    }

    public Image(final RegionCoordinate region, final Path directory, final int maxZoom, final @Nullable WorldConfig config) {
        this.region = region;
        this.directory = directory;
        this.maxZoom = maxZoom;
        this.config = config;
    }

    private boolean relief() {
        return this.config != null && this.config.MAP_RELIEF;
    }

    private boolean smooth() {
        return this.config != null && this.config.ZOOM_SMOOTH;
    }

    public synchronized void setPixel(final int x, final int z, final int color) {
        this.setPixel(x, z, color, Integer.MIN_VALUE);
    }

    /** Meridian: also records the surface height of the pixel, for the relief layer. */
    public synchronized void setPixel(final int x, final int z, final int color, final int height) {
        if (this.pixels == null) {
            this.pixels = new int[SIZE][SIZE];
            for (final int[] arr : this.pixels) {
                Arrays.fill(arr, Integer.MIN_VALUE);
            }
        }
        this.pixels[x & (SIZE - 1)][z & (SIZE - 1)] = color;

        if (this.relief()) {
            if (this.heights == null) {
                this.heights = new int[SIZE][SIZE];
                for (final int[] arr : this.heights) {
                    Arrays.fill(arr, Integer.MIN_VALUE);
                }
            }
            this.heights[x & (SIZE - 1)][z & (SIZE - 1)] = color == 0 ? Integer.MIN_VALUE : height;
        }
    }

    public synchronized void save() {
        if (this.pixels == null) {
            return;
        }

        for (int zoom = 0; zoom <= this.maxZoom; zoom++) {
            int step = (int) Math.pow(2, zoom);
            int size = SIZE / step;
            int scaledX = Mth.floor((double) this.region.x() / step);
            int scaledZ = Mth.floor((double) this.region.z() / step);

            final BufferedImage image = this.getOrCreate(this.imageInDirectory(this.maxZoom - zoom, scaledX, scaledZ), false);

            int baseX = (this.region.x() * size) & (SIZE - 1);
            int baseZ = (this.region.z() * size) & (SIZE - 1);
            for (int x = 0; x < SIZE; x += step) {
                for (int z = 0; z < SIZE; z += step) {
                    final int pixel = step > 1 && this.smooth() ? this.averageColor(x, z, step) : this.pixels[x][z];
                    if (pixel != Integer.MIN_VALUE) {
                        final int color = pixel == 0 ? TRANSPARENT : pixel;
                        image.setRGB(baseX + (x / step), baseZ + (z / step), color);
                    }
                }
            }

            this.save(this.imageInDirectory(this.maxZoom - zoom, scaledX, scaledZ), image);

            if (this.relief() && this.heights != null) {
                final Path reliefFile = this.imageInDirectory(this.directory.resolve("relief"), this.maxZoom - zoom, scaledX, scaledZ);
                final BufferedImage relief = this.getOrCreate(reliefFile, true);
                this.drawRelief(relief.getRaster(), baseX, baseZ, step, size);
                this.save(reliefFile, relief);
            }
        }
    }

    /** Meridian: the average of a step x step block, ignoring unrendered pixels; transparent if nothing opaque. */
    private int averageColor(final int x0, final int z0, final int step) {
        final int[][] px = this.pixels;
        long r = 0, g = 0, b = 0;
        int n = 0;
        boolean rendered = false;
        for (int x = x0; x < x0 + step; x++) {
            for (int z = z0; z < z0 + step; z++) {
                final int p = px[x][z];
                if (p == Integer.MIN_VALUE) {
                    continue;
                }
                rendered = true;
                if (p == 0) {
                    continue;
                }
                r += p >> 16 & 0xFF;
                g += p >> 8 & 0xFF;
                b += p & 0xFF;
                n++;
            }
        }
        if (!rendered) {
            return Integer.MIN_VALUE;
        }
        if (n == 0) {
            return 0;
        }
        return 0xFF << 24 | (int) (r / n) << 16 | (int) (g / n) << 8 | (int) (b / n);
    }

    /**
     * Meridian: hill shading for this region at one zoom level. Heights are averaged down to the zoom level first, so
     * zoomed-out tiles show the lie of the land rather than an average of noisy per-block shading.
     */
    private void drawRelief(final WritableRaster out, final int baseX, final int baseZ, final int step, final int size) {
        final WorldConfig cfg = this.config;
        final int[][] hs = this.heights;
        final float[][] h = new float[size][size];
        for (int x = 0; x < size; x++) {
            for (int z = 0; z < size; z++) {
                long sum = 0;
                int n = 0;
                for (int ix = x * step; ix < x * step + step; ix++) {
                    for (int iz = z * step; iz < z * step + step; iz++) {
                        final int v = hs[ix][iz];
                        if (v != Integer.MIN_VALUE) {
                            sum += v;
                            n++;
                        }
                    }
                }
                h[x][z] = n == 0 ? Float.NaN : (float) sum / n;
            }
        }

        final double zFactor = cfg.MAP_RELIEF_EXAGGERATION * Math.pow(step, cfg.MAP_RELIEF_ZOOM_BOOST);
        final double scale = 180.0D * cfg.MAP_RELIEF_STRENGTH;
        final double flat = Math.cos(SUN_ZENITH);
        final boolean compensate = "hard-light".equalsIgnoreCase(cfg.MAP_RELIEF_BLEND_MODE);
        for (int x = 0; x < size; x++) {
            for (int z = 0; z < size; z++) {
                final int color = step > 1 && this.smooth() ? this.averageColor(x * step, z * step, step) : this.pixels[x * step][z * step];
                if (color == 0) {
                    // rendered, but nothing there
                    out.setSample(baseX + x, baseZ + z, 1, 0);
                    continue;
                }
                final float c = h[x][z];
                if (Float.isNaN(c)) {
                    continue;
                }
                final double dzdx = slope(h, x, z, true, c) / step * zFactor;
                final double dzdy = slope(h, x, z, false, c) / step * zFactor;
                final double slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
                double aspect;
                if (dzdx != 0) {
                    aspect = Math.atan2(dzdy, -dzdx);
                    if (aspect < 0) {
                        aspect += 2 * Math.PI;
                    }
                } else {
                    aspect = dzdy > 0 ? Math.PI / 2 : (dzdy < 0 ? 3 * Math.PI / 2 : 0);
                }
                final double shade = Math.cos(SUN_ZENITH) * Math.cos(slope)
                    + Math.sin(SUN_ZENITH) * Math.sin(slope) * Math.cos(SUN_AZIMUTH - aspect);
                int v = Mth.clamp((int) Math.round(RELIEF_NEUTRAL + (shade - flat) * scale), 0, 255);
                if (compensate) {
                    v = hardLightFor(v, luminance(color), cfg.MAP_RELIEF_BRIGHT_KNEE);
                }
                out.setSample(baseX + x, baseZ + z, 0, v);
                out.setSample(baseX + x, baseZ + z, 1, 255);
            }
        }
    }

    /** Relative luminance (0..1) of an RGB colour; 0 for transparent or unrendered pixels. */
    private static double luminance(final int color) {
        if (color == 0 || color == Integer.MIN_VALUE) {
            return 0;
        }
        return (0.2126D * (color >> 16 & 0xFF) + 0.7152D * (color >> 8 & 0xFF) + 0.0722D * (color & 0xFF)) / 255.0D;
    }

    /**
     * The relief value that, blended with hard-light over a colour of luminance {@code y}, gives what soft-light would
     * give with {@code v}. Soft-light can't darken near-white, so colours brighter than {@code knee} are darkened as if
     * they were {@code knee} bright instead.
     */
    private static int hardLightFor(final int v, final double y, final double knee) {
        final double s = v / 255.0D;
        final double out;
        if (s <= 0.5D) {
            out = (1 - (1 - 2 * s) * (1 - Math.min(y, knee))) / 2;
        } else if (y >= 0.999D) {
            out = 0.5D;
        } else {
            final double d = y <= 0.25D ? ((16 * y - 12) * y + 4) * y : Math.sqrt(y);
            out = 0.5D + Mth.clamp((2 * s - 1) * (d - y) / (1 - y), 0.0D, 1.0D) / 2;
        }
        return Mth.clamp((int) Math.round(out * 255.0D), 0, 255);
    }

    /** Height difference per cell along x (east) or z (south), central where both neighbours exist. */
    private static double slope(final float[][] h, final int x, final int z, final boolean alongX, final float c) {
        final int size = h.length;
        final float before = alongX ? (x > 0 ? h[x - 1][z] : Float.NaN) : (z > 0 ? h[x][z - 1] : Float.NaN);
        final float after = alongX ? (x < size - 1 ? h[x + 1][z] : Float.NaN) : (z < size - 1 ? h[x][z + 1] : Float.NaN);
        final boolean hasBefore = !Float.isNaN(before);
        final boolean hasAfter = !Float.isNaN(after);
        if (hasBefore && hasAfter) {
            return (after - before) / 2.0D;
        } else if (hasAfter) {
            return after - c;
        } else if (hasBefore) {
            return c - before;
        }
        return 0;
    }

    private BufferedImage getOrCreate(final Path file, final boolean relief) {
        if (!Files.isRegularFile(file)) {
            return relief ? newReliefImage() : newBufferedImage();
        }

        try {
            final @Nullable BufferedImage read = ImageIO.read(file.toFile());
            if (read == null) {
                throw new IOException("Failed to read image file '" + file.toAbsolutePath() + "', ImageIO.read(File) result is null. This means no " +
                    "supported image format was able to read it. The image file may have been malformed or corrupted, it will be overwritten.");
            }
            if (relief && !(read.getColorModel() instanceof ComponentColorModel && read.getRaster().getNumBands() == 2)) {
                return reliefFromOpaque(read.getRaster());
            }
            return read;
        } catch (final IOException ex) {
            try {
                Files.deleteIfExists(file);
            } catch (final IOException ex0) {
                ex.addSuppressed(ex0);
            }
            this.logCouldNotRead(ex);
            return relief ? newReliefImage() : newBufferedImage();
        }
    }

    private void save(final Path out, final BufferedImage image) {
        try {
            FileUtil.atomicWrite(out, tmp -> {
                try (final OutputStream outputStream = new BufferedOutputStream(Files.newOutputStream(tmp))) {
                    save(image, outputStream);
                }
            });
        } catch (final IOException ex) {
            this.logCouldNotSave(ex);
        }
    }

    private static void save(final BufferedImage image, final OutputStream out) throws IOException {
        final ImageWriter writer = ImageIO.getImageWritersByFormatName("png").next();
        try (final ImageOutputStream imageOutputStream = ImageIO.createImageOutputStream(out)) {
            writer.setOutput(imageOutputStream);
            final ImageWriteParam param = writer.getDefaultWriteParam();
            if (Config.COMPRESS_IMAGES && param.canWriteCompressed()) {
                param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                if (param.getCompressionType() == null) {
                    param.setCompressionType(param.getCompressionTypes()[0]);
                }
                param.setCompressionQuality(Config.COMPRESSION_RATIO);
            }
            writer.write(null, new IIOImage(image, null, null), param);
        }
    }

    private Path imageInDirectory(final int zoom, final int scaledX, final int scaledZ) {
        return this.imageInDirectory(this.directory, zoom, scaledX, scaledZ);
    }

    private Path imageInDirectory(final Path base, final int zoom, final int scaledX, final int scaledZ) {
        final Path dir = base.resolve(Integer.toString(zoom));
        if (!Files.exists(dir)) {
            try {
                Files.createDirectories(dir);
            } catch (final IOException e) {
                throw new RuntimeException(Logging.replace(Messages.LOG_COULD_NOT_CREATE_DIR, "path", dir.toAbsolutePath()), e);
            }
        }
        final String fileName = scaledX + "_" + scaledZ + ".png";
        return dir.resolve(fileName);
    }

    private static BufferedImage newBufferedImage() {
        return new BufferedImage(Image.SIZE, Image.SIZE, BufferedImage.TYPE_INT_ARGB);
    }

    private static BufferedImage newReliefImage() {
        final WritableRaster raster = RELIEF_COLOR_MODEL.createCompatibleWritableRaster(Image.SIZE, Image.SIZE);
        final int[] row = new int[Image.SIZE];
        Arrays.fill(row, RELIEF_NEUTRAL);
        for (int y = 0; y < Image.SIZE; y++) {
            raster.setSamples(0, y, Image.SIZE, 1, 0, row);
        }
        return new BufferedImage(RELIEF_COLOR_MODEL, raster, false, null);
    }

    /** Converts a relief tile from before relief tiles had alpha: neutral grey there meant nothing to shade. */
    private static BufferedImage reliefFromOpaque(final Raster old) {
        final BufferedImage image = newReliefImage();
        final WritableRaster raster = image.getRaster();
        for (int x = 0; x < Image.SIZE; x++) {
            for (int y = 0; y < Image.SIZE; y++) {
                final int v = old.getSample(x, y, 0);
                raster.setSample(x, y, 0, v);
                raster.setSample(x, y, 1, v == RELIEF_NEUTRAL ? 0 : 255);
            }
        }
        return image;
    }

    private void logCouldNotRead(final IOException ex) {
        Logging.logger().error(xz(Messages.LOG_COULD_NOT_READ_REGION), ex);
    }

    private void logCouldNotSave(final IOException ex) {
        Logging.logger().error(xz(Messages.LOG_COULD_NOT_SAVE_REGION), ex);
    }

    private String xz(final String s) {
        return Logging.replace(s, "x", this.region.x(), "z", this.region.z());
    }
}
