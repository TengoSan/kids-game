"""Pillow不要のシンプルなPNGアイコン生成（風船の絵柄）"""
import struct, zlib, math, os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def create_png(width, height, pixels):
    """RGBA pixels → PNG bytes"""
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter none
        for x in range(width):
            raw += bytes(pixels[y * width + x])

    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw, 9)) +
            chunk(b'IEND', b''))

def dist(x1, y1, x2, y2):
    return math.sqrt((x1-x2)**2 + (y1-y2)**2)

def create_icon(size, filename):
    pixels = [(0,0,0,0)] * (size * size)
    corner_r = size * 0.2

    bg = (94, 200, 248)        # そらいろ #5ec8f8
    balloon = (255, 82, 82)    # あか #ff5252
    balloon_dark = (198, 40, 40)
    highlight = (255, 176, 176)
    string_col = (255, 255, 255)

    cx = size * 0.5
    cy = size * 0.40           # 風船の中心はやや上
    rx = size * 0.27
    ry = size * 0.31
    knot_y = cy + ry           # 結び目の上端

    for y in range(size):
        for x in range(size):
            # 角丸の背景判定
            in_rect = True
            if ((x < corner_r or x > size - corner_r) and
                (y < corner_r or y > size - corner_r)):
                crx = corner_r if x < corner_r else size - corner_r
                cry = corner_r if y < corner_r else size - corner_r
                if dist(x, y, crx, cry) > corner_r:
                    in_rect = False
            if not in_rect:
                continue

            col = bg

            # ひも（ゆらゆらした白い線）
            if knot_y + size * 0.04 <= y <= size * 0.88:
                sx = cx + math.sin((y - knot_y) / size * 9) * size * 0.035
                if abs(x - sx) <= max(size * 0.012, 1):
                    col = string_col

            # 結び目（小さな三角）
            if knot_y - size * 0.01 <= y <= knot_y + size * 0.055:
                half = (y - (knot_y - size * 0.01)) * 0.7 + size * 0.005
                if abs(x - cx) <= half:
                    col = balloon_dark

            # 風船本体（楕円）
            dxn = (x - cx) / rx
            dyn = (y - cy) / ry
            if dxn * dxn + dyn * dyn <= 1.0:
                col = balloon
                # ハイライト（左上の光）
                hxn = (x - (cx - rx * 0.38)) / (rx * 0.30)
                hyn = (y - (cy - ry * 0.42)) / (ry * 0.26)
                if hxn * hxn + hyn * hyn <= 1.0:
                    col = highlight

            pixels[y * size + x] = col + (255,)

    png_data = create_png(size, size, pixels)
    with open(filename, 'wb') as f:
        f.write(png_data)
    print(f'Created {filename} ({size}x{size})')

create_icon(192, os.path.join(BASE_DIR, 'icon-192.png'))
create_icon(512, os.path.join(BASE_DIR, 'icon-512.png'))
create_icon(180, os.path.join(BASE_DIR, 'apple-touch-icon.png'))
