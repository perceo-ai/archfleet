#!/usr/bin/env python3
"""Create clone libvirt XML from a source domain XML.

The clone keeps the source VM's hardware/configuration shape and rewrites only
the fields that cannot be shared by simultaneously running domains: name, disk
path, UUID, MAC address, and user-network host-forward ports.
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET


QEMU_NS = "http://libvirt.org/schemas/domain/qemu/1.0"
QEMU = f"{{{QEMU_NS}}}"


def rewrite_domain_xml(
    source_xml: str,
    out_xml: str,
    domain: str,
    disk_path: str,
    ssh_port: str,
    rdp_port: str,
    host_bind: str = "127.0.0.1",
) -> None:
    ET.register_namespace("qemu", QEMU_NS)
    tree = ET.parse(source_xml)
    root = tree.getroot()

    name = root.find("name")
    if name is None:
        raise SystemExit("source domain XML has no <name>")
    name.text = domain

    for elem in list(root):
        if elem.tag in {"uuid", "metadata"}:
            root.remove(elem)

    disk_updated = False
    for disk_elem in root.findall("./devices/disk"):
        if disk_elem.get("device") != "disk":
            continue
        source = disk_elem.find("source")
        if source is None:
            source = ET.SubElement(disk_elem, "source")
        source.attrib.clear()
        source.set("file", disk_path)
        disk_updated = True
        break
    if not disk_updated:
        raise SystemExit("source domain XML has no disk device to clone")

    for mac in root.findall("./devices/interface/mac"):
        mac.attrib.pop("address", None)

    args = root.findall(f"./{QEMU}commandline/{QEMU}arg")
    netdev = f"user,id=unet,hostfwd=tcp:{host_bind}:{ssh_port}-:22,hostfwd=tcp:{host_bind}:{rdp_port}-:3389"
    replaced_netdev = False
    for arg in args:
        value = arg.get("value", "")
        if value.startswith("user,id=") and "hostfwd=tcp:" in value:
            arg.set("value", netdev)
            replaced_netdev = True
            break

    if not replaced_netdev:
        commandline = root.find(f"./{QEMU}commandline")
        if commandline is None:
            commandline = ET.SubElement(root, f"{QEMU}commandline")
        ET.SubElement(commandline, f"{QEMU}arg", {"value": "-netdev"})
        ET.SubElement(commandline, f"{QEMU}arg", {"value": netdev})
        ET.SubElement(commandline, f"{QEMU}arg", {"value": "-device"})
        ET.SubElement(commandline, f"{QEMU}arg", {"value": "virtio-net-pci,netdev=unet,addr=0x10"})

    tree.write(out_xml, encoding="unicode", xml_declaration=True)


def main(argv: list[str]) -> int:
    if len(argv) not in {7, 8}:
        print(
            "usage: clone-domain-xml.py SOURCE_XML OUT_XML DOMAIN DISK_PATH SSH_PORT RDP_PORT [HOST_BIND]",
            file=sys.stderr,
        )
        return 2
    rewrite_domain_xml(*argv[1:])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
