"""Generates common/src/main/resources/squaremap/block_colors.txt: the average colour of each block's top face,
taken from the vanilla textures, so the map uses real texture colours instead of the 62-colour map palette.

usage: python tools/gen_block_colors.py <path to an extracted vanilla client jar (the folder holding assets/)>

Line format:  <block id> <RRGGBB> [grass|foliage|water]
A trailing tint word means the texture is grey and the game tints it by biome at render time; the renderer multiplies
the biome colour in. Blocks the game tints with a fixed colour (spruce/birch leaves, lily pads) are baked here.
"""
import json
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(sys.argv[1]) / "assets" / "minecraft"
MODELS = ROOT / "models"
TEXTURES = ROOT / "textures"
OUT = pathlib.Path(__file__).resolve().parents[1] / "common" / "src" / "main" / "resources" / "squaremap" / "block_colors.txt"

# tinted by biome (see net.minecraft.client.color.block.BlockColors)
GRASS = {"grass_block", "short_grass", "tall_grass", "fern", "large_fern", "potted_fern", "sugar_cane", "bush"}
FOLIAGE = {"oak_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves", "mangrove_leaves", "vine"}
WATER = {"water", "bubble_column", "water_cauldron"}
# tinted with a constant colour by the client
FIXED = {"spruce_leaves": 0x619961, "birch_leaves": 0x80A755, "lily_pad": 0x208030, "attached_melon_stem": 0xE0C71C,
         "attached_pumpkin_stem": 0xE0C71C, "redstone_wire": 0x960000}
# blocks without a same-named model: the texture to use instead
TEXTURE_FALLBACK = {
    "water": "block/water_still", "lava": "block/lava_still", "bubble_column": "block/water_still",
    "fire": "block/fire_0", "soul_fire": "block/soul_fire_0", "redstone_wire": "block/redstone_dust_dot",
    "kelp": "block/kelp", "kelp_plant": "block/kelp_plant", "seagrass": "block/seagrass", "tall_seagrass": "block/tall_seagrass_top",
    "snow": "block/snow", "powder_snow": "block/powder_snow", "cave_vines": "block/cave_vines", "cave_vines_plant": "block/cave_vines_plant",
    "twisting_vines": "block/twisting_vines", "weeping_vines": "block/weeping_vines", "big_dripleaf": "block/big_dripleaf_top",
    "small_dripleaf": "block/small_dripleaf_top", "pitcher_plant": "block/pitcher_crop_top_stage_4",
    "tall_grass": "block/tall_grass_top", "large_fern": "block/large_fern_top", "sunflower": "block/sunflower_front",
    "lilac": "block/lilac_top", "rose_bush": "block/rose_bush_top", "peony": "block/peony_top",
}
# suffixes to try when a block has no model with its exact name
SUFFIXES = ["", "_top", "_upper", "_floor", "_stage3", "_stage7", "_stage_3", "_age3", "_bottom", "_inventory", "_0",
            "_1", "_noside", "_post", "_side", "_on", "_off", "_single", "_one", "_1_age0", "_bottom_left"]

model_cache = {}


def load_model(name):
    name = name.replace("minecraft:", "")
    if "/" not in name:
        name = "block/" + name
    if name in model_cache:
        return model_cache[name]
    f = MODELS / f"{name}.json"
    m = json.loads(f.read_text()) if f.exists() else None
    model_cache[name] = m
    return m


def resolve(name):
    """Merged textures and elements through the parent chain."""
    textures, elements = {}, None
    seen = 0
    while name and seen < 20:
        m = load_model(name)
        if m is None:
            break
        for k, v in m.get("textures", {}).items():
            textures.setdefault(k, v)
        if elements is None and "elements" in m:
            elements = m["elements"]
        name = m.get("parent")
        seen += 1
    return textures, elements or []


def deref(tex, textures):
    for _ in range(10):
        if tex and tex.startswith("#"):
            tex = textures.get(tex[1:])
        else:
            break
    return tex


def top_texture(model_name):
    textures, elements = resolve(model_name)
    best, best_y, tinted = None, -1, False
    for el in elements:
        faces = el.get("faces", {})
        if "up" in faces:
            y = el.get("to", [0, 0, 0])[1]
            if y >= best_y:
                best, best_y, tinted = faces["up"].get("texture"), y, "tintindex" in faces["up"]
    tex = deref(best, textures)
    if not tex:
        # flat or cross models (flowers, saplings, rails): no up face
        for k in ("top", "end", "up", "all", "texture", "cross", "plant", "rail", "flower", "crop", "particle", "side"):
            if k in textures:
                tex = deref("#" + k, textures)
                if tex:
                    break
        tinted = any("tintindex" in f for el in elements for f in el.get("faces", {}).values())
    return tex, tinted


def average(texture):
    path = TEXTURES / (texture.replace("minecraft:", "") + ".png")
    if not path.exists():
        return None
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    if h > w:  # animated: first frame
        img = img.crop((0, 0, w, w))
    r = g = b = n = 0.0
    for pr, pg, pb, pa in img.getdata():
        if pa < 16:
            continue
        a = pa / 255.0
        r += pr * a
        g += pg * a
        b += pb * a
        n += a
    if n == 0:
        return None
    return int(r / n), int(g / n), int(b / n)


def block_ids():
    # every block with a loot table, plus every same-named block model; unknown ids are ignored by the plugin
    ids = set()
    loot = pathlib.Path(sys.argv[1]) / "data" / "minecraft" / "loot_table" / "blocks"
    if loot.exists():
        ids |= {p.stem for p in loot.glob("*.json")}
    ids |= {p.stem for p in (MODELS / "block").glob("*.json")}
    ids |= set(TEXTURE_FALLBACK) | GRASS | FOLIAGE | WATER | set(FIXED)
    return sorted(ids)


def main():
    lines, missing = [], []
    for bid in block_ids():
        rgb = None
        tinted = False
        if bid in TEXTURE_FALLBACK:
            rgb = average(TEXTURE_FALLBACK[bid])
            tinted = bid in GRASS or bid in FOLIAGE or bid in WATER
        else:
            for suffix in SUFFIXES:
                if load_model(bid + suffix) is None:
                    continue
                tex, tinted = top_texture(bid + suffix)
                if tex:
                    rgb = average(tex)
                    if rgb:
                        break
        if rgb is None:
            missing.append(bid)
            continue
        tint = ""
        if bid in FIXED:
            f = FIXED[bid]
            rgb = (rgb[0] * (f >> 16 & 255) // 255, rgb[1] * (f >> 8 & 255) // 255, rgb[2] * (f & 255) // 255)
        elif bid in GRASS:
            tint = " grass"
        elif bid in FOLIAGE:
            tint = " foliage"
        elif bid in WATER:
            tint = " water"
        lines.append(f"minecraft:{bid} {rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}{tint}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("# generated by tools/gen_block_colors.py from the vanilla 1.21.11 textures\n" + "\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(lines)} block colours written to {OUT}; no texture found for {len(missing)} ids")
    print("missing:", " ".join(missing[:80]))


if __name__ == "__main__":
    main()
