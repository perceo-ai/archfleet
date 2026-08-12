import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "clone-domain-xml.py"


SOURCE_XML = """\
<domain type="kvm" xmlns:qemu="http://libvirt.org/schemas/domain/qemu/1.0">
  <name>cuf-golden</name>
  <uuid>11111111-1111-1111-1111-111111111111</uuid>
  <memory unit="MiB">8192</memory>
  <vcpu>4</vcpu>
  <features><acpi/><apic/></features>
  <cpu mode="host-passthrough"/>
  <devices>
    <emulator>/usr/bin/qemu-system-x86_64</emulator>
    <disk type="file" device="disk">
      <driver name="qemu" type="qcow2"/>
      <source file="/old/golden.qcow2"/>
      <target dev="vda" bus="virtio"/>
    </disk>
    <interface type="user">
      <mac address="52:54:00:aa:bb:cc"/>
    </interface>
  </devices>
  <qemu:commandline>
    <qemu:arg value="-netdev"/>
    <qemu:arg value="user,id=unet,hostfwd=tcp::10022-:22,hostfwd=tcp::13389-:3389"/>
    <qemu:arg value="-device"/>
    <qemu:arg value="virtio-net-pci,netdev=unet,addr=0x10"/>
  </qemu:commandline>
</domain>
"""


class CloneDomainXmlTest(unittest.TestCase):
    def test_preserves_source_shape_and_rewrites_only_clone_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.xml"
            output = Path(tmp) / "clone.xml"
            source.write_text(SOURCE_XML)

            subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    str(source),
                    str(output),
                    "cuf-bank-1",
                    "/new/cuf-bank-1.qcow2",
                    "11022",
                    "14389",
                ],
                check=True,
            )

            root = ET.parse(output).getroot()
            qemu_ns = "{http://libvirt.org/schemas/domain/qemu/1.0}"

            self.assertEqual(root.findtext("name"), "cuf-bank-1")
            self.assertIsNone(root.find("uuid"))
            self.assertEqual(root.findtext("memory"), "8192")
            self.assertEqual(root.findtext("vcpu"), "4")
            self.assertEqual(root.find("./devices/disk/source").get("file"), "/new/cuf-bank-1.qcow2")
            self.assertIsNone(root.find("./devices/interface/mac").get("address"))

            args = [arg.get("value") for arg in root.findall(f"./{qemu_ns}commandline/{qemu_ns}arg")]
            self.assertIn("user,id=unet,hostfwd=tcp:127.0.0.1:11022-:22,hostfwd=tcp:127.0.0.1:14389-:3389", args)
            self.assertIn("virtio-net-pci,netdev=unet,addr=0x10", args)


if __name__ == "__main__":
    unittest.main()
