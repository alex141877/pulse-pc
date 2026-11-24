from PIL import Image, ImageDraw

size = 512
image = Image.new("RGBA", (size, size))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((12, 12, 500, 500), radius=110, fill="#101821")
draw.rounded_rectangle((26, 26, 486, 486), radius=96, outline="#355266", width=8)
draw.rounded_rectangle((92, 120, 420, 352), radius=44, fill="#213748", outline="#426477", width=9)
draw.line([(122, 250), (186, 250), (220, 189), (270, 291), (310, 229), (385, 229)],
          fill="#78ebc2", width=17, joint="curve")
for point in ((122, 250), (385, 229)):
    x, y = point
    draw.ellipse((x-8, y-8, x+8, y+8), fill="#78ebc2")
draw.rounded_rectangle((238, 349, 274, 393), radius=11, fill="#78ebc2")
draw.rounded_rectangle((179, 385, 333, 406), radius=10, fill="#78ebc2")
image.save("icon-512.png")
image.resize((192, 192), Image.Resampling.LANCZOS).save("icon-192.png")
image.save("desktop/icon.ico", sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
from pathlib import Path
Path("android/app/src/main/res/drawable").mkdir(parents=True, exist_ok=True)
image.resize((192, 192), Image.Resampling.LANCZOS).save("android/app/src/main/res/drawable/pulsepc.png")
