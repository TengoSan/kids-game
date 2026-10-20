# アイコン画像（PNG）を外部ライブラリなしで生成する
import struct, zlib

SPRITE = [
    "..xxxxxxxx..",
    "..xexxxxex..",
    "xxxxxxxxxxxx",
    "xxxxxxxxxxxx",
    "..xxxxxxxx..",
    "..xxxxxxxx..",
    "..x.x..x.x..",
    "..x.x..x.x..",
]
BG = (0xFB, 0xF6, 0xEF)
GROUND = (0x7E, 0x9F, 0x57)
COLORS = {"x": (0xD9, 0x7A, 0x4A), "e": (0x1F, 0x1A, 0x17)}

def make(size, path):
    unit = size // 16
    ox = (size - 12 * unit) // 2
    oy = (size - 8 * unit) // 2 - unit
    ground_y = oy + 8 * unit
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            c = GROUND if y >= ground_y + unit // 2 else BG
            gx, gy = (x - ox) // unit, (y - oy) // unit
            if 0 <= gx < 12 and 0 <= gy < 8 and x >= ox and y >= oy:
                ch = SPRITE[gy][gx]
                if ch in COLORS:
                    c = COLORS[ch]
            row += bytes(c)
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)

make(192, "icon-192.png")
make(512, "icon-512.png")
make(180, "apple-touch-icon.png")
