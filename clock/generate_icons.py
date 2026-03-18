"""Pillow不要のシンプルなPNGアイコン生成"""
import struct, zlib, math

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

def blend(bg, fg, a):
    return tuple(int(bg[i]*(1-a) + fg[i]*a) for i in range(3)) + (255,)

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def create_icon(size, filename):
    pixels = [(0,0,0,0)] * (size * size)
    cx, cy = size/2, size/2
    r = size * 0.45
    corner_r = size * 0.2

    hour_colors = ['#e53935','#ff8a65','#66bb6a','#2e7d32',
                   '#00897b','#29b6f6','#1565c0','#3949ab',
                   '#7b1fa2','#c0ca33','#fdd835','#ff9800']

    for y in range(size):
        for x in range(size):
            # 角丸の背景
            in_rect = True
            for (crx, cry) in [(corner_r, corner_r), (size-corner_r, corner_r),
                               (corner_r, size-corner_r), (size-corner_r, size-corner_r)]:
                if ((x < corner_r or x > size-corner_r) and
                    (y < corner_r or y > size-corner_r)):
                    if dist(x, y, crx, cry) > corner_r:
                        in_rect = False
            if not in_rect:
                continue

            d = dist(x, y, cx, cy)
            bg = (102, 126, 234, 255)  # #667eea

            if d <= r:
                # 文字盤内
                sector_r = r * 0.78
                inner_r = r * 0.35

                if d <= inner_r:
                    # 中心（白）
                    pixels[y*size+x] = (255, 255, 255, 255)
                elif d <= sector_r:
                    # カラーセクター
                    angle = math.degrees(math.atan2(y - cy, x - cx)) + 90
                    if angle < 0: angle += 360
                    idx = int(angle / 30) % 12
                    rgb = hex_to_rgb(hour_colors[idx])
                    pixels[y*size+x] = rgb + (255,)
                else:
                    # 白リング + 数字エリア
                    pixels[y*size+x] = (255, 255, 255, 255)
            else:
                pixels[y*size+x] = bg

    # 針を描画（短針: 赤, 10時10分）
    hour_angle = math.radians(10 * 30 + 10 * 0.5 - 90)
    min_angle = math.radians(10 * 6 - 90)
    hour_len = r * 0.45
    min_len = r * 0.72

    for t in [i * 0.002 for i in range(501)]:
        # 短針
        hx = int(cx + hour_len * t * math.cos(hour_angle))
        hy = int(cy + hour_len * t * math.sin(hour_angle))
        hw = max(int(size * 0.015), 1)
        for dy in range(-hw, hw+1):
            for dx in range(-hw, hw+1):
                px, py = hx+dx, hy+dy
                if 0 <= px < size and 0 <= py < size and dist(px,py,hx,hy) <= hw:
                    pixels[py*size+px] = (198, 40, 40, 255)

        # 長針
        mx = int(cx + min_len * t * math.cos(min_angle))
        my = int(cy + min_len * t * math.sin(min_angle))
        mw = max(int(size * 0.01), 1)
        for dy in range(-mw, mw+1):
            for dx in range(-mw, mw+1):
                px, py = mx+dx, my+dy
                if 0 <= px < size and 0 <= py < size and dist(px,py,mx,my) <= mw:
                    pixels[py*size+px] = (46, 125, 50, 255)

    # 中心点
    dot_r = max(int(size * 0.02), 2)
    for dy in range(-dot_r, dot_r+1):
        for dx in range(-dot_r, dot_r+1):
            px, py = int(cx)+dx, int(cy)+dy
            if 0 <= px < size and 0 <= py < size and dist(px,py,cx,cy) <= dot_r:
                pixels[py*size+px] = (51, 51, 51, 255)

    png_data = create_png(size, size, pixels)
    with open(filename, 'wb') as f:
        f.write(png_data)
    print(f'Created {filename} ({size}x{size})')

create_icon(192, '/Users/toyatetsuro/ゲーム作成/とけいゲーム/icon-192.png')
create_icon(512, '/Users/toyatetsuro/ゲーム作成/とけいゲーム/icon-512.png')
create_icon(180, '/Users/toyatetsuro/ゲーム作成/とけいゲーム/apple-touch-icon.png')
