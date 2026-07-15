#!/usr/bin/env python3
"""Встраивает исходники дашборда (gui/index.html + style.css + app.js)
в GUI_HTML внутри файла ccost — дистрибуция остаётся одним файлом.

Правишь дашборд в gui/ -> python3 tools/embed.py -> коммитишь оба."""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
gui = root / "gui"
html = (gui / "index.html").read_text()
css = (gui / "style.css").read_text()
js = (gui / "app.js").read_text()
html = html.replace('<link rel="stylesheet" href="style.css">',
                    "<style>\n" + css + "</style>")
html = html.replace('<script src="app.js"></script>',
                    "<script>\n" + js + "</script>")
assert "style.css" not in html and "app.js" not in html, "маркеры не заменились"
assert '"""' not in html, "тройные кавычки сломают встраивание"

ccost = root / "ccost"
src = ccost.read_text()
new, n = re.subn(r'GUI_HTML = r""".*?"""',
                 lambda m: 'GUI_HTML = r"""' + html + '"""',
                 src, count=1, flags=re.S)
assert n == 1, "блок GUI_HTML не найден"
ccost.write_text(new)
print(f"встроено: {len(css)} css + {len(js)} js -> ccost")
