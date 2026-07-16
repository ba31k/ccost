#!/usr/bin/env python3
"""Inlines the dashboard sources (gui/index.html + style.css + app.js) into
the GUI_HTML block inside ccost, keeping the distribution a single file.

Edit the dashboard in gui/ -> python3 tools/embed.py -> commit both."""
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
assert "style.css" not in html and "app.js" not in html, "markers not replaced"
assert '"""' not in html, "triple quotes would break embedding"

ccost = root / "ccost"
src = ccost.read_text()
new, n = re.subn(r'GUI_HTML = r""".*?"""',
                 lambda m: 'GUI_HTML = r"""' + html + '"""',
                 src, count=1, flags=re.S)
assert n == 1, "GUI_HTML block not found"
ccost.write_text(new)
print(f"embedded: {len(css)} css + {len(js)} js -> ccost")
