import importlib.util
import pathlib
import tempfile
import unittest

pathlib.Path('.local').mkdir(exist_ok=True)
tempfile.tempdir = str(pathlib.Path('.local').resolve())

spec = importlib.util.spec_from_file_location('manifest', pathlib.Path(__file__).with_name('manifest.py'))
module = importlib.util.module_from_spec(spec)
if spec.loader:
    spec.loader.exec_module(module)


class ManifestTests(unittest.TestCase):
    def test_detects_changed_missing_and_unexpected_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / 'file.txt').write_bytes(b'original\n')
            module.create(root, 'a' * 40)
            module.verify(root)
            (root / 'file.txt').write_bytes(b'tampered\n')
            with self.assertRaises(ValueError):
                module.verify(root)
            (root / 'file.txt').write_bytes(b'original\n')
            (root / '.env').write_bytes(b'secret')
            with self.assertRaises(ValueError):
                module.verify(root)
            (root / '.env').unlink()
            (root / 'file.txt').unlink()
            with self.assertRaises(ValueError):
                module.verify(root)

    def test_rejects_symlinks_and_unsafe_manifest_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / 'RELEASE').write_text('a' * 40 + '\n')
            (root / 'SHA256SUMS').write_text('0' * 64 + '  ../secret\n')
            with self.assertRaises(ValueError):
                module.verify(root)

    def test_rejects_invalid_revision(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                module.create(pathlib.Path(tmp), 'latest')


if __name__ == '__main__':
    unittest.main()
