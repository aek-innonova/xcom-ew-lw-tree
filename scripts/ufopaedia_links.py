#!/usr/bin/env python3
"""Extract UFOpaedia link targets for Long War unlocks into ufopaedia.json.

UFOpaedia has no page per Long War tech, Foundry project or item; its
"Research (Long War)" table links each unlock to a section of a category page
(e.g. Combat Stims -> Equipment_(Long_War)#Utility_devices). This script reads
that table and the Foundry page and records name -> link, so the site can link
the same places. Run it again if the wiki changes:

    python3 scripts/ufopaedia_links.py > ufopaedia.json
"""
import html
import json
import re
import sys
import urllib.request
from datetime import date

BASE = 'https://www.ufopaedia.org'
PAGES = ['/index.php/Research_(Long_War)', '/index.php/Foundry_(Long_War)']


def fetch(path):
    req = urllib.request.Request(BASE + path, headers={'User-Agent': 'xcom-ew-lw-tree link extractor'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8')


def links_in(fragment):
    for href, text in re.findall(r'<a href="(/[^"]+)"[^>]*>(.*?)</a>', fragment, re.S):
        text = html.unescape(re.sub(r'<[^>]+>', '', text)).strip()
        if text and not href.startswith(('/File:', '/Special:', '/index.php?')):
            yield text, href


def main():
    items = {}
    for path in PAGES:
        page = fetch(path)
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
            cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
            # The first cell names the tech or project; links in the rest are its unlocks.
            for cell in cells[1:]:
                for text, href in links_in(cell):
                    items.setdefault(text, href)
    json.dump(
        {
            'source': [BASE + p for p in PAGES],
            'fetched': date.today().isoformat(),
            'note': 'Unlock name -> UFOpaedia link (a section of a category page), as the wiki links them.',
            'items': dict(sorted(items.items())),
        },
        sys.stdout,
        indent=1,
        ensure_ascii=False,
    )


if __name__ == '__main__':
    main()
