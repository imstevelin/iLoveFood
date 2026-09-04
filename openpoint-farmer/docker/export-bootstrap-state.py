#!/usr/bin/env python3
"""Export the minimum anonymous OPENPOINT state needed by a fresh container."""

import argparse
import os
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path


REQUIRED_KEYS = (
    "mid",
    "vcode",
    "GID",
    "GUID",
    "pre_member_status",
    "FIRST_TIME",
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument(
        "destination",
        nargs="?",
        type=Path,
        default=Path(__file__).parent / "private" / "bootstrap-prefs.xml",
    )
    args = parser.parse_args()

    source_root = ET.parse(args.source).getroot()
    by_name = {node.attrib.get("name"): node for node in source_root}
    missing = [key for key in REQUIRED_KEYS if key not in by_name]
    if missing:
        raise SystemExit("Missing required preference keys: " + ", ".join(missing))

    destination_root = ET.Element("map")
    for key in REQUIRED_KEYS:
        source_node = by_name[key]
        destination_node = ET.SubElement(
            destination_root, source_node.tag, dict(source_node.attrib)
        )
        destination_node.text = source_node.text

    args.destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        prefix="bootstrap-prefs.", suffix=".xml", dir=args.destination.parent
    )
    try:
        with os.fdopen(fd, "wb") as output:
            ET.ElementTree(destination_root).write(
                output, encoding="utf-8", xml_declaration=True
            )
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, args.destination)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)

    print(f"Exported {len(REQUIRED_KEYS)} anonymous bootstrap fields")


if __name__ == "__main__":
    main()
