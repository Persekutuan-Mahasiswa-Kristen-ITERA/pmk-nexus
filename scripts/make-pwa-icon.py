from pathlib import Path
from PIL import Image

source = Path(__file__).resolve().parent.parent / "public/brand/pmk-logo.png"
target = source.with_name("pmk-logo-512.png")
with Image.open(source) as image:
    image.convert("RGBA").resize((512, 512), Image.Resampling.LANCZOS).save(target, optimize=True)
print(f"Created {target}")
