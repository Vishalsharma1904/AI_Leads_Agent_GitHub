"""Shape Devanagari with HarfBuzz and rasterise the resulting glyphs with FreeType."""
from functools import lru_cache
from pathlib import Path
import sys
from PIL import Image

DEPS = Path('C:/Users/Khushi/.codex/visualizations/2026/10/06/01a11213-f3fa-7791-a144-34615189cea0/render-deps')
sys.path.insert(0, str(DEPS))
import uharfbuzz as hb
import freetype

FONT = Path('C:/Windows/Fonts/Nirmala.ttc')
FONT_DATA = FONT.read_bytes()

@lru_cache(maxsize=512)
def shaped(value, pixel_size, bold=False):
    index = 1 if bold else 0
    face = hb.Face(FONT_DATA, index)
    hfont = hb.Font(face)
    hfont.scale = (pixel_size*64, pixel_size*64)
    hb.ot_font_set_funcs(hfont)
    buffer = hb.Buffer()
    buffer.add_str(value)
    buffer.guess_segment_properties()
    buffer.direction = 'ltr'
    buffer.language = 'hi'
    hb.shape(hfont, buffer)
    ft = freetype.Face(str(FONT), index=index)
    ft.set_pixel_sizes(0, pixel_size)
    pen = 0.0
    glyphs = []
    for glyph, pos in zip(buffer.glyph_infos, buffer.glyph_positions):
        assert glyph.codepoint != 0, f'Missing glyph in Hindi font: {value}'
        ft.load_glyph(glyph.codepoint, freetype.FT_LOAD_RENDER | freetype.FT_LOAD_TARGET_NORMAL)
        slot = ft.glyph
        bm = slot.bitmap
        if bm.width and bm.rows:
            raw = bytes(bm.buffer)
            if bm.pitch != bm.width:
                raw = b''.join(raw[i*abs(bm.pitch):i*abs(bm.pitch)+bm.width] for i in range(bm.rows))
            mask = Image.frombytes('L', (bm.width,bm.rows), raw)
            gx = round(pen+pos.x_offset/64+slot.bitmap_left)
            gy = round(-pos.y_offset/64-slot.bitmap_top)
            glyphs.append((mask,gx,gy))
        pen += pos.x_advance/64
    if not glyphs:
        return Image.new('L',(max(1,round(pen)),1),0), 0, pen
    minx=min(0,min(g[1] for g in glyphs))
    miny=min(g[2] for g in glyphs)
    maxx=max(round(pen),max(g[1]+g[0].width for g in glyphs))
    maxy=max(g[2]+g[0].height for g in glyphs)
    mask=Image.new('L',(maxx-minx,maxy-miny),0)
    for bitmap,gx,gy in glyphs:
        # Lighter antialiased pixels cannot erase overlapping glyph outlines.
        from PIL import ImageChops
        region=mask.crop((gx-minx,gy-miny,gx-minx+bitmap.width,gy-miny+bitmap.height))
        mask.paste(ImageChops.lighter(region,bitmap),(gx-minx,gy-miny))
    return mask, minx, pen
